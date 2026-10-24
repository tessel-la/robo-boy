# Third-party notices

Robo-Boy uses these icon collections through react-icons. SVG paths are adapted to React
components; the collections retain their original licenses and ownership:

- Font Awesome Free 5, by Fonticons, Inc. (https://fontawesome.com/), icons licensed under
  Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).
- Material Design icons, by Google (https://github.com/google/material-design-icons),
  Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0).
- Feather, by Cole Bemis (https://feathericons.com/), MIT; notice below.
- Heroicons 2, by Tailwind Labs, Inc. (https://heroicons.com/), MIT; notice below.

Production frontend and Electron shell builds include licenses.txt with the project license,
these credits, and license/NOTICE texts for the JavaScript packages in their bundles. Keep the
shell and renderer notices together when distributing Electron. Native runtimes, Rust/system
libraries, external panels, and robot assets retain separate license obligations; this file does
not relicense them.

## Source licenses omitted from npm releases

The notice generator includes these unmodified upstream texts for the exact releases below.
Their npm tarballs declare the license but omit its text. A new version requires a new review.

- `@ai-sdk/provider-utils@5.0.56`: [Vercel AI SDK license](https://github.com/vercel/ai/blob/e7f55a481fe2c39bd2540162ee8b45bd8de3354b/LICENSE),
  retained as `third-party/ai-sdk-provider-utils-LICENSE` (Apache-2.0).
- `@cfworker/json-schema@4.1.1`: [cfworker license](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md),
  retained as `third-party/cfworker-json-schema-LICENSE` (MIT).

## Tauri MPL source access

The Tauri lockfile includes the following MPL 2.0 components. If included in a distributed
executable, their corresponding source and upstream license files are available in these archives:

- cssparser 0.36.0: https://static.crates.io/crates/cssparser/cssparser-0.36.0.crate
- cssparser-macros 0.6.1: https://static.crates.io/crates/cssparser-macros/cssparser-macros-0.6.1.crate
- dtoa-short 0.3.5: https://static.crates.io/crates/dtoa-short/dtoa-short-0.3.5.crate
- option-ext 0.2.0: https://static.crates.io/crates/option-ext/option-ext-0.2.0.crate
- selectors 0.36.1: https://static.crates.io/crates/selectors/selectors-0.36.1.crate

These components retain the Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/).
Distribute modifications to their covered source files under the MPL. This source-access list
does not replace the inventory and notices for the native libraries in each finished installer.

## Feather — MIT

The MIT License (MIT)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Heroicons — MIT

MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
