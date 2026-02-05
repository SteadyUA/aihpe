FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bullseye
# RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
#     && apt-get -y install --no-install-recommends socat netcat-openbsd iputils-ping dnsutils procps curl iproute2 git openssh-client vim less \
#     && curl -fsSL https://get.docker.com | sh

# Script to fix the Antigravity server path discrepancy dynamically
RUN echo '#!/bin/bash\n\
    while true; do\n\
    if [ -d /home/node/.antigravity-server/bin ]; then\n\
    cd /home/node/.antigravity-server/bin\n\
    for d in *-*; do\n\
    if [ -d "$d" ]; then\n\
    TARGET="${d##*-}"\n\
    if [ ! -L "$TARGET" ]; then\n\
    ln -sfn "$d" "$TARGET"\n\
    fi\n\
    fi\n\
    done\n\
    fi\n\
    sleep 5\n\
    done' > /usr/local/bin/antigravity-fix-path.sh && chmod +x /usr/local/bin/antigravity-fix-path.sh
