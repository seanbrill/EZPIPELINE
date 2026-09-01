import os
import pty
import sys
import select
import subprocess
import signal

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 bridge.py <command> [args...]")
        sys.exit(1)

    command = sys.argv[1:]
    
    # Create PTY
    # pty.fork() returns (pid, fd)
    # pid is 0 in child, new pid in parent
    pid, master_fd = pty.fork()

    if pid == 0:
        # CHILD: Execute the command
        try:
            # Disable Echo on the slave PTY to prevent double-echo in XTerm
            import termios
            attrs = termios.tcgetattr(sys.stdin)
            # Disable ECHO, ECHOE, ECHONL to prevent double-echo
            # Disable ECHO, ECHOE, ECHONL to prevent double-echo
            # Disable OCRNL (Map CR to NL on output) - Fixes "Hyperspacing..." stacking
            # Keep ONLCR (Map NL to CR-NL on output) ENABLED so XTerm gets \r\n
            attrs[3] = attrs[3] & ~termios.ECHO & ~termios.ECHOE & ~termios.ECHONL
            attrs[1] = attrs[1] & ~termios.OCRNL
            # Disable ICRNL (Map CR to NL on input) - preserves \r
            attrs[0] = attrs[0] & ~termios.ICRNL
            termios.tcsetattr(sys.stdin, termios.TCSANOW, attrs)

            # Re-enable SIGINT/SIGTERM (in case Node masked them)
            # os.execvp will replace the process
            os.execvp(command[0], command)
        except Exception as e:
            sys.stderr.write(f"Error executing command: {e}\n")
            sys.exit(1)
    else:
        # PARENT: Set window size to something reasonable (120x40) to prevent wrapping/dumb-mode
        try:
            import fcntl
            import termios
            import struct
            # rows, cols, xpixels, ypixels
            winsize = struct.pack("HHHH", 40, 120, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

        # PARENT: Relay I/O
        # We need to read from stdin (Node pipe) -> write to master_fd
        # Read from master_fd -> write to stdout (Node pipe)
        
        def cleanup(signum, frame):
            os.kill(pid, signal.SIGTERM)
            sys.exit(0)

        signal.signal(signal.SIGINT, cleanup)
        signal.signal(signal.SIGTERM, cleanup)

        try:
            while True:
                # Watch master_fd and sys.stdin for reading
                r, w, x = select.select([master_fd, sys.stdin.fileno()], [], [])

                if master_fd in r:
                    # Read from PTY
                    try:
                        data = os.read(master_fd, 1024)
                        if not data:
                            break # EOF
                        os.write(sys.stdout.fileno(), data)
                        sys.stdout.flush()
                    except OSError:
                        break

                if sys.stdin.fileno() in r:
                    # Read from Node pipe
                    try:
                        data = os.read(sys.stdin.fileno(), 1024)
                        if not data:
                            # Stdin closed by parent (Node)
                            # We should probably close master_fd input or send EOF?
                            # For interactive CLI, we might just keep running until PTY exits
                            pass 
                        else:
                            os.write(master_fd, data)
                    except OSError:
                        pass
        except Exception:
            pass
        finally:
            # Cleanup
            try:
                os.close(master_fd)
            except:
                pass
            # Wait for child to exit to avoid zombie
            os.waitpid(pid, 0)

if __name__ == "__main__":
    main()
