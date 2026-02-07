FROM ubuntu:24.04

# 1. Copy dependency files and install them
WORKDIR /app

# 2. Indicate to Node.js where to locate the installed modules
ENV NODE_PATH=/app/node_modules

# Configure variables
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG FTP_PROXY
ARG NO_PROXY
ARG USER=ubuntu
ARG TEMP_DIR=/tmp/project

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Copy project files to the workspace directory
COPY . $TEMP_DIR

# Create env_vars file
RUN echo "export HTTP_PROXY=\"$HTTP_PROXY\"" > $TEMP_DIR/env_vars && \
  echo "export HTTPS_PROXY=\"$HTTPS_PROXY\"" >> $TEMP_DIR/env_vars && \
  echo "export FTP_PROXY=\"$FTP_PROXY\"" >> $TEMP_DIR/env_vars && \
  echo "export NO_PROXY=\"$NO_PROXY\"" >> $TEMP_DIR/env_vars && \
  echo "export USER=\"$USER\"" >> $TEMP_DIR/env_vars && \
  echo "export TEMP_DIR=\"$TEMP_DIR\"" >> $TEMP_DIR/env_vars

# Run main setup script
# Set Git safe directory
# Change ownership of the project directory
WORKDIR $TEMP_DIR

RUN ./.config/devcontainer/ubuntu/scripts/init.sh && \
  git config --system --add safe.directory $TEMP_DIR && \
  chown -R $USER:$USER $TEMP_DIR

# Create and configure shell files for the developer user
RUN mkdir -p /home/$USER && \
    touch /home/$USER/.bashrc /home/$USER/.profile /home/$USER/.bash_profile && \
    echo "[ -f \"\$HOME/.bashrc\" ] && . \"\$HOME/.bashrc\"" >> /home/$USER/.profile && \
    echo "[ -z \"\$BASH_VERSION\" ] || [ -f \"\$HOME/.bashrc\" ] && . \"\$HOME/.bashrc\"" >> /home/$USER/.bash_profile && \
    chown -R $USER:$USER /home/$USER && \
    chmod -R u+rw /home/$USER

# Install Taskfile
RUN .config/task/install.sh

# Install system-level dependencies as root (apt packages, global binaries)
RUN --mount=type=secret,id=env_vars \
    bash -l -c 'task dev:setup-environment'

# Switch to non-root user
USER $USER

# Configure bash as default shell with proper sourcing of .bashrc
SHELL ["/bin/bash", "-l", "-c"]
ENV SHELL=/bin/bash
ENV USER=$USER

# Add local bin to PATH (append, do not shadow system interpreters)
ENV PATH="${PATH}:/home/${USER}/.local/bin"

# Install user-level tools as $USER (nvm, uv, pipx, go bins, lefthook)
RUN --mount=type=secret,id=env_vars \
    bash -l -c 'task dev:setup-environment'

# Run final scripts
RUN ./.config/devcontainer/ubuntu/scripts/setup-docker.sh "$USER" \
  && ./.config/devcontainer/ubuntu/scripts/cleanup.sh

# Create the workspace directory
WORKDIR /home/$USER/workspace/project

# Final user-level cleanup to reduce image size (safe cache purges)
RUN bash -lc "set -euo pipefail; \
  echo '🧹 Pruning user-level caches'; \
  if command -v uv >/dev/null 2>&1; then \
    uv cache prune || true; \
  fi; \
  if command -v npm >/dev/null 2>&1; then \
    npm cache clean --force || true; \
  fi; \
  if command -v pnpm >/dev/null 2>&1; then \
    pnpm store prune || true; \
  fi; \
  if command -v yarn >/dev/null 2>&1; then \
    yarn cache clean || true; \
  fi; \
  rm -rf \"$HOME/.bun/install/cache\" \"$HOME/.bun/cache\" 2>/dev/null || true; \
  rm -rf \"$HOME/.ansible/tmp\" \"$HOME/.ansible/pc\" 2>/dev/null || true; \
  rm -rf \"$HOME/.cache\"/* 2>/dev/null || true; \
  rm -rf \"$HOME/go/pkg\" \"$HOME/go/cache\" 2>/dev/null || true; \
"

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD task --version || exit 1

# Set default command to start a login shell
CMD ["/bin/bash", "-l"]
