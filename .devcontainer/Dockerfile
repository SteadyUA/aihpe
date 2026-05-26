FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bullseye

# Temporary fix for the IDE bug: wrapping curl and wget to replace space in the URL with %20
RUN mv /usr/bin/curl /usr/bin/curl-original && \
    echo '#!/bin/bash\n\
args=()\n\
for arg in "$@"; do\n\
    if [[ "$arg" == *"Antigravity IDE"* ]]; then\n\
        arg="${arg//Antigravity IDE/Antigravity%20IDE}"\n\
    fi\n\
    args+=("$arg")\n\
done\n\
exec /usr/bin/curl-original "${args[@]}"' > /usr/bin/curl && chmod +x /usr/bin/curl && \
    mv /usr/bin/wget /usr/bin/wget-original && \
    echo '#!/bin/bash\n\
args=()\n\
for arg in "$@"; do\n\
    if [[ "$arg" == *"Antigravity IDE"* ]]; then\n\
        arg="${arg//Antigravity IDE/Antigravity%20IDE}"\n\
    fi\n\
    args+=("$arg")\n\
done\n\
exec /usr/bin/wget-original "${args[@]}"' > /usr/bin/wget && chmod +x /usr/bin/wget
