#!/bin/bash
osascript -e "tell application \"Terminal\" to do script \"cd $(pwd)/apps/client && npm run dev\""
osascript -e "tell application \"Terminal\" to do script \"cd $(pwd)/apps/server && npm run dev\""
