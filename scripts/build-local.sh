#!/bin/bash
# Builds ezpipeline-local: the shipped image with YOUR apps/server/data in it.
#
# Two things changed here and both were forced by real problems.
#
# 1. It builds the base image first. Dockerfile.baked used to be a copy of
#    Dockerfile with two extra lines, so every fix to one had to be made twice.
#    It now layers onto ezpipeline:latest, which has to exist first.
#
# 2. --build-context snapshot=./apps/server/data. The root .dockerignore
#    excludes that directory, because at 1.5 GB it was being uploaded to the
#    Docker daemon on every build of every Dockerfile in this repo, including
#    the ones that did not want it. A named build context carries its own
#    ignore rules, so this build - the only one that wants the data - opts back
#    in without making the others pay for it.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Building the base image first (ezpipeline:latest)..."
docker build -t ezpipeline .

echo
echo "Building the local image with baked-in data (ezpipeline-local:latest)."
echo "This WILL include your current apps/server/data: app.db, pipeline"
echo "workspaces, build history, and any credentials stored in them."
echo "Do not push the result anywhere public."
echo

docker build \
  -f Dockerfile.baked \
  --build-context snapshot=./apps/server/data \
  -t ezpipeline-local \
  .

echo
echo "Done. Run it with:"
echo "  docker run --env-file .env -p 5000:5000 ezpipeline-local"
