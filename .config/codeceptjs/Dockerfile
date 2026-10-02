# kics-scan disable=fd54f200-402c-4333-a5a4-36ef6709af2f,b03a748a-542d-44f4-bb86-9199ab4fd2d5,965a08d7-ef86-4f14-8792-4a3b2098937e
FROM mcr.microsoft.com/playwright:v1.63.0

WORKDIR /app

# Use bash with pipefail option to secure pipes (|)
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install task
# Curl retry/backoff/timeout flags throughout: shared-runner egress to
# Cloudflare-fronted hosts intermittently stalls; an unbounded curl then dies
# with exit 28 and kills the image build (observed in CI).
RUN sh -c "$(curl --location --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 120 https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# Install uv so `task copier` (which runs `uvx copier`) works from inside
# the dockerised test runner without depending on host Python/pip state.
# Pre-warm Python + copier so the first scenario doesn't pay the ~30-60 s
# cold-start cost fetching the interpreter and wheel on demand.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    UV_CACHE_DIR=/opt/uv/cache
RUN curl -LsSf --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 120 https://astral.sh/uv/install.sh | \
      env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh && \
    /usr/local/bin/uv python install 3.14 && \
    /usr/local/bin/uvx --python 3.14 --from copier==9.14.3 copier --version

# Install Docker CLI + Compose plugin so the runner can orchestrate ttyd
# containers from inside the test container via the mounted docker socket.
# The Playwright base image is Ubuntu, so we pull from the Ubuntu channel.
#
# The base image also leaves NodeSource's apt repository configured, and we
# install nothing from it — the Node it ships is the one the image already
# baked in. But `apt-get update` still reads it, so the day NodeSource
# answered 403 Forbidden, every pipeline in the project died on a package
# nobody here wanted. Dropping that source list makes this build depend only
# on the archives it actually installs from.
# hadolint ignore=DL3008
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 120 https://download.docker.com/linux/ubuntu/gpg | \
      gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    UBUNTU_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")" && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list && \
    rm -f /etc/apt/sources.list.d/nodesource.list && \
    apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      docker-ce-cli docker-compose-plugin \
      ca-certificates curl git golang-go jq pipx python3 unzip wget xz-utils && \
    rm -rf /var/lib/apt/lists/*
# The extra packages are the union of everything the .config/*/install.sh
# scripts may apt-install: dev:setup-environment runs INSIDE this runner for
# the init-effects scenarios, and when two workers hit a missing apt package
# simultaneously they race on the apt lock (exit 100, observed with unzip
# then xz-utils). Baking them all removes every scenario-time apt call.

# Copy dependency files first (cache optimization)
COPY .config/codeceptjs/package.json .config/codeceptjs/package-lock.json /app/.config/codeceptjs/

# Install dependencies (cached if package files unchanged), then the browser
# THIS playwright asks for. The base image only ever ships the browsers of its
# own release, while Renovate moves the image tag and the npm package apart:
# npm publishes first and the image tag follows days later, so the two are
# routinely a version out of step. Relying on the base image alone then makes
# every scenario die on "Executable doesn't exist at /ms-playwright/...".
# When both versions already agree the install is a no-op, so it costs nothing.
# The local binary, never npx: npx re-resolves from the registry on every call.
WORKDIR /app/.config/codeceptjs
RUN npm ci && \
    ./node_modules/.bin/playwright install chromium && \
    ln -s /app/.config/codeceptjs/node_modules/.bin/codeceptjs /usr/local/bin/codeceptjs

WORKDIR /app

# Copy remaining config files (steps, step_definitions, etc.)
COPY .config/codeceptjs /app/.config/codeceptjs
