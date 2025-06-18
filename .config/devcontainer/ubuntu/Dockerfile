FROM codeceptjs/codeceptjs:3.7.3

# 1. Copy dependency files and install them
WORKDIR /app
COPY .config/codeceptjs/package.json .config/codeceptjs/package-lock.json* ./
RUN npm install --production=false

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

# Switch to non-root user
USER $USER

# Configure bash as default shell with proper sourcing of .bashrc
SHELL ["/bin/bash", "-l", "-c"]
ENV SHELL=/bin/bash
ENV USER=$USER

# Add local bin to PATH
ENV PATH="/home/${USER}/.local/bin:${PATH}"

RUN echo "3.12" > $TEMP_DIR/.config/python/.python-version

# Run setup task with login shell to ensure .bashrc is sourced
RUN --mount=type=secret,id=env_vars \
    bash -l -c 'task dev:setup-environment'

# Run final scripts
RUN ./.config/devcontainer/ubuntu/scripts/setup-docker.sh "$USER" \
  && ./.config/devcontainer/ubuntu/scripts/cleanup.sh

# Create the workspace directory
WORKDIR /home/$USER/workspace/project

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD task --version || exit 1

# Set default command to start a login shell
CMD ["/bin/bash", "-l"]
