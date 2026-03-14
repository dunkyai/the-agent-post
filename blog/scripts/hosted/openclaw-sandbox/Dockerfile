FROM node:22-alpine

RUN apk add --no-cache \
    python3 py3-pip \
    bash curl jq \
    git

# Create non-root sandbox user
RUN addgroup -g 1001 -S sandbox && \
    adduser -u 1001 -S sandbox -G sandbox

# Create workspace
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace

USER sandbox
WORKDIR /workspace
