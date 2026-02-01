# kics-scan disable=fd54f200-402c-4333-a5a4-36ef6709af2f,b03a748a-542d-44f4-bb86-9199ab4fd2d5,965a08d7-ef86-4f14-8792-4a3b2098937e
FROM mcr.microsoft.com/playwright:v1.58.1

WORKDIR /app

# Use bash with pipefail option to secure pipes (|)
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install bun (much faster than npm) and task
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun && \
    sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# Copy dependency files first (cache optimization)
COPY .config/codeceptjs/package.json .config/codeceptjs/package-lock.json /app/.config/codeceptjs/

# Install dependencies (cached if package files unchanged)
WORKDIR /app/.config/codeceptjs
RUN bun install && ln -s /app/.config/codeceptjs/node_modules/.bin/codeceptjs /usr/local/bin/codeceptjs

WORKDIR /app

# Copy remaining config files (steps, step_definitions, etc.)
COPY .config/codeceptjs /app/.config/codeceptjs
