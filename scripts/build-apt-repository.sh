#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 DEB OUTPUT_DIRECTORY" >&2
  exit 2
fi

deb_path=$1
output_directory=$2

for command in dpkg-deb dpkg-scanpackages gzip md5sum sha256sum; do
  if ! command -v "$command" >/dev/null; then
    echo "required command not found: $command" >&2
    exit 1
  fi
done

if [ ! -f "$deb_path" ]; then
  echo "Debian package not found: $deb_path" >&2
  exit 1
fi

if [ -e "$output_directory" ]; then
  echo "output path already exists: $output_directory" >&2
  exit 1
fi

package_name=$(dpkg-deb --field "$deb_path" Package)
package_version=$(dpkg-deb --field "$deb_path" Version)
package_architecture=$(dpkg-deb --field "$deb_path" Architecture)

if [ "$package_name" != "robo-boy" ]; then
  echo "expected package 'robo-boy', found '$package_name'" >&2
  exit 1
fi

if [ "$package_architecture" != "amd64" ]; then
  echo "expected architecture 'amd64', found '$package_architecture'" >&2
  exit 1
fi

if [[ ! "$package_version" =~ ^[0-9A-Za-z.+:~_-]+$ ]]; then
  echo "package has an unsafe Debian version: $package_version" >&2
  exit 1
fi

packages_directory="$output_directory/dists/stable/main/binary-amd64"
pool_directory="$output_directory/pool/main/r/robo-boy"
mkdir -p "$packages_directory" "$pool_directory"

install -m 0644 \
  "$deb_path" \
  "$pool_directory/robo-boy_${package_version}_amd64.deb"

(
  cd "$output_directory"
  dpkg-scanpackages --arch amd64 pool /dev/null
) >"$packages_directory/Packages"
gzip -9n -c "$packages_directory/Packages" >"$packages_directory/Packages.gz"

release_directory="$output_directory/dists/stable"
release_file="$release_directory/Release"
release_date=$(LC_ALL=C date -Ru)

{
  echo "Origin: Robo-Boy"
  echo "Label: Robo-Boy"
  echo "Suite: stable"
  echo "Codename: stable"
  echo "Date: $release_date"
  echo "Architectures: amd64"
  echo "Components: main"
  echo "Description: Official Robo-Boy Debian packages"
  echo "MD5Sum:"
  for relative_path in main/binary-amd64/Packages main/binary-amd64/Packages.gz; do
    file="$release_directory/$relative_path"
    printf ' %s %16d %s\n' \
      "$(md5sum "$file" | awk '{print $1}')" \
      "$(wc -c <"$file")" \
      "$relative_path"
  done
  echo "SHA256:"
  for relative_path in main/binary-amd64/Packages main/binary-amd64/Packages.gz; do
    file="$release_directory/$relative_path"
    printf ' %s %16d %s\n' \
      "$(sha256sum "$file" | awk '{print $1}')" \
      "$(wc -c <"$file")" \
      "$relative_path"
  done
} >"$release_file"

echo "Built APT repository for robo-boy $package_version ($package_architecture)"
