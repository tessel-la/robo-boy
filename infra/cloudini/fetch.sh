#!/bin/sh
set -eu
root="$1"
mkdir -p "$root"
fetch() {
  name="$1"; url="$2"; checksum="$3"
  curl -fLsS --retry 3 "$url" -o "$root/$name.tar.gz"
  printf '%s  %s\n' "$checksum" "$root/$name.tar.gz" | sha256sum -c -
  mkdir -p "$root/$name"
  tar -xzf "$root/$name.tar.gz" -C "$root/$name" --strip-components=1
}
fetch cloudini https://codeload.github.com/facontidavide/cloudini/tar.gz/0c7135c943889540205ba6833cad8dfd65178079 \
  4d4728fc873f653ef2b9992ba5363399ffec0d494485ce8ff29a0659e092200d
fetch zstd https://codeload.github.com/facebook/zstd/tar.gz/refs/tags/v1.5.7 \
  37d7284556b20954e56e1ca85b80226768902e2edabd3b649e9e72c0c9012ee3
fetch lz4 https://codeload.github.com/lz4/lz4/tar.gz/refs/tags/v1.10.0 \
  537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b
