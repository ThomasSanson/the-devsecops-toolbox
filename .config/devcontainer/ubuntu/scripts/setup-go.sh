#!/bin/bash

# Setup Go environment variables in the system-wide profile
cat >/etc/profile.d/go.sh <<'EOF'
# Go environment variables
export GOROOT=/usr/local/go
export GOPATH=$HOME/go
export PATH=$GOROOT/bin:$GOPATH/bin:$PATH
EOF

# Make the script executable
chmod +x /etc/profile.d/go.sh

# Create symbolic links to make Go available system-wide
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

echo "✅ Go environment configured successfully"
