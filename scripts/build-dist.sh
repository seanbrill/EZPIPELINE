#!/bin/bash
echo "Building Distribution Image (Clean State)..."
echo "This build will NOT include any local data/databases."
docker build -t ezpipeline .
