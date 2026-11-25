# Self-hosting on AWS

Settings › Self-hosting › **Deploy to a cloud** puts EZPipeline in your own AWS account:
one container on ECS Fargate, its data on an encrypted EFS volume, behind a network load
balancer. It can bring this instance's people and data with it.

Azure and Google Cloud come next, in the same wizard. Until then their cards are shown but
cannot be picked.

## What it makes

| Resource | Why |
|---|---|
| ECR repository | Holds the EZPipeline image, copied from FileFreak's container registry, so the task never pulls across the internet at start-up |
| ECS cluster, task definition, service | One task, never two: `desired_count = 1`, minimum healthy 0 %, maximum 100 %. The old task stops before a new one starts |
| EFS file system and 2 mount targets | The data directory (`/data`), SQLite included. Encrypted at rest and in transit |
| Network load balancer and target group | The public address. TCP on 80 until the certificate is issued, then TLS on 443 only |
| ACM certificate | Only with a custom domain |
| 2 Elastic IPs | Only with *Static IP addresses* |
| IAM role | The task's execution role: pull from ECR, write logs |
| 3 security groups | Load balancer: the one port, from anywhere. Task: only from the load balancer. Volume: only from the task |
| CloudWatch log group | `/ezpipeline/<name>`, kept 30 days |

Everything goes in the region's **default VPC**, in two of its default subnets. The task gets
a public address so it can reach ECR without a NAT gateway (which would cost more than the
rest together); its security group only lets the load balancer in.

**Single node.** Pipeline steps run inside the container, so it never scales out: two copies
on one SQLite database would corrupt it.

## Before you start

On the instance that deploys (not your laptop, unless that is the instance):

- the **AWS CLI**, **Terraform** and **Docker** plugins (Settings › Plugins), and Docker running;
- an AWS sign-in: a CLI profile on the host (`aws configure`, or `aws sso login`), or an
  access key pasted into the wizard;
- the permissions on Connect. The wizard asks IAM's policy simulator about every call the
  Terraform makes and, for anything missing, shows the exact statement to add.

The image comes from FileFreak's container registry, `api.filefreak.io/ezpipeline/ezpipeline:<version>`,
which the release pipeline publishes ([Releasing](RELEASING.md)). Review checks that anybody
can pull it and warns if not; a host signed in to the registry (`filefreak docker setup`)
can still pull a private one. Set `EZP_SELFHOST_IMAGE` on the server to another repository
(no tag; the version is added).

## The seven steps

1. **Choose a cloud.**
2. **Connect.** Sign in, and the permission check. A pasted key is stored encrypted, and handed
   to the deploy as secret variables on its pipeline.
3. **Configure.** Name (the prefix of every resource), region, size, storage, address. Name and
   region are fixed once deployed. Without a custom domain the address is the load
   balancer's own, which has no certificate, so it is plain HTTP: fine to try it, not for a team.
4. **Your data.** *Start fresh* (you are its admin, with the password you use here), *Move this
   instance* (everyone and everything), or *Import a bundle* (an `.ezp` file, with you as admin).
5. **Review.** What gets made, the Terraform (copy or download it), the cost estimate, and
   anything in the region that would stop it: no default VPC, or not enough Elastic IPs left.
6. **Deploy.** Runs on this server; you can close the page.
7. **Done.** For a move: keep this instance as a stand-by (schedules and auto deploy stay
   paused here), or keep both running.

## The deploy is a pipeline

Deploy writes two pipelines into the **Self-hosting** group, *Deploy &lt;name&gt; to AWS* and
*Remove &lt;name&gt; from AWS*, and runs the first. So its log is an ordinary run log, a failed
step can be retried from where it stopped, and a change (a bigger size, a domain) is a run
from *Create service*.

| Step | What it does |
|---|---|
| Check the tools | `aws`, `terraform`, `docker`, the sign-in, `terraform init` |
| Create container registry | `terraform apply -target=aws_ecr_repository.ezpipeline` |
| Push image | `docker pull --platform linux/amd64` from FileFreak's registry, then push to ECR |
| Create volume | EFS and its mount targets |
| Create service | Everything else: `terraform apply` |
| Wait for health check | `/api/instance` must answer 3 times in a row; on failure, the last CloudWatch lines |
| Move data | The hand-over, below |
| Point DNS | Prints the CNAME (and A records with static IPs) and the certificate's validation record, waits up to 2 hours for the certificate, then switches the listener to TLS on 443 |

The Terraform, its state and its secret variables live in this instance's data directory,
`selfhost/<id>/tf/` (mode 600). Those two pipelines are left out of exports and moves: they
drive this instance's deploy and mean nothing anywhere else.

## The hand-over

The new instance starts with no users and two secrets in its task definition, set through
AWS's API: `JWT_SECRET`, and `EZP_SETUP_TOKEN`. While it has a setup token:

- its *create the first admin* page is shut, so nobody who finds the address first can claim it;
- it takes **one** hand-over, `POST /api/selfhost/receive`: an envelope encrypted with
  AES-256-GCM under a key derived from that token. Without the token it can be neither read
  nor forged, so it is safe over the load balancer's plain address.

The envelope holds the users (their password hashes, so everyone signs in as they do here),
their permissions, and for a move an `.ezp` bundle of the whole instance, its secrets sealed
with a one-time passphrase that travels inside the same envelope. Once anyone exists there,
the route refuses, and the token does nothing more.

What does not go across: run logs (runs keep their status and commit), archived versions,
and plugins, which you install there.

## Removing it

A deploy that stopped keeps what its finished steps made, and AWS bills it. Retry, or
*Remove what was created*: type the name, and *Remove &lt;name&gt; from AWS* runs
`terraform destroy`, **including the volume and the data on it**. A draft whose resources
are still in AWS cannot be discarded.

## Cost

The estimate comes from a price table in the code (`apps/server/src/services/selfhost/prices.ts`),
on-demand prices for us-east-1, dated. It counts three public IPv4 addresses whatever you
choose: AWS bills every one, attached or not, and the load balancer has one per zone whether
or not they are Elastic IPs. AWS's bill is the real number.
