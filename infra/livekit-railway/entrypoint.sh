#!/bin/sh
set -eu

: "${LIVEKIT_KEYS:?Set a LiveKit key and secret as a YAML mapping}"
: "${RAILWAY_TCP_PROXY_DOMAIN:?Create a Railway TCP proxy for this service}"
: "${RAILWAY_TCP_PROXY_PORT:?Railway did not supply a public TCP port}"
: "${RAILWAY_TCP_APPLICATION_PORT:?Railway did not supply the application TCP port}"

signal_port=7880
tcp_port=$RAILWAY_TCP_PROXY_PORT
app_port=$RAILWAY_TCP_APPLICATION_PORT
case "$signal_port:$tcp_port:$app_port" in
  *[!0-9:]*) echo 'Invalid Railway ports' >&2; exit 1 ;;
esac

public_ip=$(dig +short A "$RAILWAY_TCP_PROXY_DOMAIN" | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }')
[ -n "$public_ip" ] || { echo 'Railway TCP proxy has no IPv4 address' >&2; exit 1; }

umask 077
cat > /tmp/livekit.yaml <<EOF
port: $signal_port
log_level: info
rtc:
  tcp_port: $tcp_port
  force_tcp: true
  use_external_ip: false
  stun_servers: []
turn:
  enabled: false
EOF

# LiveKit listens on the same port it advertises in ICE. Railway forwards
# the public port to the fixed application port used by this service.
if [ "$app_port" != "$tcp_port" ]; then
  local_ip=$(ip -4 addr show scope global | awk '/inet / { split($2, a, "/"); print a[1]; exit }')
  [ -n "$local_ip" ] || { echo 'LiveKit needs a non-loopback address for ICE TCP' >&2; exit 1; }
  socat "TCP-LISTEN:$app_port,reuseaddr,fork" "TCP:$local_ip:$tcp_port" &
fi

echo "LiveKit signaling on $signal_port and ICE TCP $app_port → $tcp_port"
exec livekit-server --config /tmp/livekit.yaml --port "$signal_port" \
  --node-ip "$public_ip" --rtc.tcp_port "$tcp_port" --rtc.force_tcp
