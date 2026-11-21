FROM livekit/livekit-server:v1.13.11 AS livekit
FROM alpine:3.23
RUN apk add --no-cache ca-certificates socat bind-tools
COPY --from=livekit /livekit-server /usr/local/bin/livekit-server
COPY entrypoint.sh /usr/local/bin/radio-entrypoint
RUN chmod +x /usr/local/bin/radio-entrypoint
EXPOSE 7880 7881 7882/udp
ENTRYPOINT ["/usr/local/bin/radio-entrypoint"]
