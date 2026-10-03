FROM golang:1.27.1-alpine AS gosu-build
WORKDIR /build
# Keep the official privilege-switch helper, rebuilding its vulnerable Go dependencies.
RUN go mod init taskflow-gosu-build \
    && go get github.com/tianon/gosu@6456aaa0f3c854d199d0f037f068eb97515b7513 golang.org/x/sys@v0.44.0 \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gosu github.com/tianon/gosu

FROM mysql:8.4
# The server/CLI client do not need MySQL Shell's bundled vulnerable Python packages.
RUN microdnf remove -y mysql-shell && microdnf upgrade -y && microdnf clean all
COPY --from=gosu-build /gosu /usr/local/bin/gosu
