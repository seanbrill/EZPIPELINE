#!/bin/bash

# Get current timestamp
TIMESTAMP=$(date +"%Y%m%d%H%M%S")
IMAGE_NAME="ezpipeline-snapshot:$TIMESTAMP"
LATEST_TAG="ezpipeline-snapshot:latest"

echo "📸 Creating EZPIPELINE snapshot: $IMAGE_NAME"

# Build the docker image
# We use the current directory context to include all local changes, yaml files, envs, etc.
docker build -f Dockerfile -t $IMAGE_NAME -t $LATEST_TAG .

if [ $? -eq 0 ]; then
    echo "✅ Snapshot created successfully!"
    echo "   Image: $IMAGE_NAME"
    echo "   Tag:   $LATEST_TAG"
    echo ""
    echo "To run this snapshot:"
    echo "   docker run -p 5000:5000 $LATEST_TAG"
else
    echo "❌ Build failed."
fi
