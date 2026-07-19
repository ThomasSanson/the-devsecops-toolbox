# kics-scan disable=b03a748a-542d-44f4-bb86-9199ab4fd2d5,965a08d7-ef86-4f14-8792-4a3b2098937e
# ↳ b03a748a: healthcheck — test container, not a long-lived service
# ↳ 965a08d7: apt pin version — ephemeral test container, always uses latest
FROM ubuntu:24.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG BOOTSTRAP_USER=bootstrap

# 1. Only essential packages (what a dev would already have)
#    Also set a dpkg lock timeout so concurrent apt invocations wait
#    instead of failing immediately when a hook still holds the lock.
# hadolint ignore=DL3008
RUN echo 'DPkg::Lock::Timeout "120";' > /etc/apt/apt.conf.d/99lock-timeout && \
    apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends sudo curl ca-certificates git jq unzip xz-utils gnupg tree && \
    rm -rf /var/lib/apt/lists/*

# 2. Bootstrap user with passwordless sudo
RUN useradd -m -s /bin/bash ${BOOTSTRAP_USER} && \
    echo "${BOOTSTRAP_USER} ALL=(ALL) NOPASSWD:ALL" \
      > /etc/sudoers.d/${BOOTSTRAP_USER} && \
    chmod 0440 /etc/sudoers.d/${BOOTSTRAP_USER}

# 3. ttyd (web terminal for visual regression tests)
ARG TTYD_VERSION=1.7.7
# Curl retry/backoff/timeout: shared-runner egress to GitHub releases
# intermittently stalls; an unbounded curl then dies with exit 28 and kills
# the image build (observed in CI).
RUN UNAME_ARCH="$(uname -m)" && \
    curl -fsSL --retry 8 --retry-all-errors --retry-delay 5 --connect-timeout 15 --max-time 120 \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${UNAME_ARCH}" \
      -o /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd

# 4. PATH includes ~/.local/bin (where task, glab, etc. are installed)
#    PROMPT_COMMAND marker for ttyd command completion detection
RUN echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" \
      >> /home/${BOOTSTRAP_USER}/.bashrc && \
    echo "export GOPATH=\"\$HOME/.local\"" \
      >> /home/${BOOTSTRAP_USER}/.bashrc && \
    echo 'PROMPT_COMMAND="touch /tmp/ttyd-cmd-done"' \
      >> /home/${BOOTSTRAP_USER}/.bashrc

# 5. Workspace directory + shared download-cache mount point. A named volume is
#    mounted at /cache at runtime; a fresh (empty) volume inherits this dir's
#    ownership, so the non-root bootstrap user can populate the shared uv cache
#    (see project/ubuntu/docker-compose.yml).
RUN mkdir -p /workspace /cache && \
    chown -R ${BOOTSTRAP_USER}:${BOOTSTRAP_USER} /workspace /cache

USER ${BOOTSTRAP_USER}
WORKDIR /workspace
CMD ["bash", "-c", "while :; do sleep 10 & wait; done"]
