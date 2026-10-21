# License and deployment audit

Reviewed October 21, 2026 against `dev` commit `7506921`; fixes are on `codex/license-privacy-audit`.

**Apache 2.0 permits commercial use, sales, and proprietary derivatives.** Keep its required license
and notices. An exclusive relicense also requires contributor ownership/permission. See the
[Apache license](https://www.apache.org/licenses/LICENSE-2.0).

## Fixed on this branch

- **Icons:** Android now uses the existing Robo-Boy launcher/adaptive icons, synchronized during
  init and builds. Web maskable PNGs have their declared 192 × 192 and 512 × 512 dimensions and an
  opaque safe area. One working generator replaces the duplicate scripts: `npm run icons:generate`.
- **Attribution:** existing icon collections remain in use. [Third-party notices](../THIRD_PARTY_NOTICES.md)
  identify their licenses and preserve upstream credits. Web/Tauri, Electron, and enterprise builds
  generate `licenses.txt` from their bundled JavaScript and worker inputs, including upstream LICENSE/NOTICE
  material. Attribution lives in documentation and release files, without additional app UI.
  Missing license material fails the build.
- **Project license:** package, SDK, and Rust metadata now match the repository's Apache 2.0 license;
  the SDK package includes its license text. Earlier published grants are not revoked.
- **Enterprise image:** ships a bundled gateway and notices instead of the full frontend production
  dependency tree. This excludes unused `roslib → pngparse 2.0.1`, whose license remains unresolved.
- **Claude privacy:** discovery, login, and inference explicitly disable Claude Code's nonessential
  traffic. Live vendor-network behavior was not packet-captured.
- **Electron capture:** the main app needs native microphone approval, revoked on reload/navigation.
  Approved panel sandboxes need separate capture approval; arbitrary embedded pages are refused.
  Tests cover origin/type checks, rejection, concurrent prompts, and late responses after navigation.
- **Disclosures:** assistant settings explain the context sent to providers and unencrypted browser
  key storage. iOS microphone text covers speech recognition and AI transcription.

## Deployment choices and remaining limits

The intended robot-access model is unchanged: the default stack serves trusted networks/VPNs;
public access should use the [enterprise gateway](enterprise.md) and isolate direct robot ports.
The control lease coordinates operators; it is not user authentication.

No application analytics/crash-upload service was found. Optional AI sends workspace/robot context,
conversation and selected attachments to its provider; browser speech recognition may use a separate
remote service. Updates/catalogs contact GitHub. Enterprise sessions, access logs, local app state,
and robot recordings require deployment-specific retention/access rules. Browser/Tauri API keys
remain unencrypted in local storage; use per-user keys or an authenticated proxy for shared use.

Paid/hosted AI features require separate provider eligibility: see
[OpenAI plan usage](https://developers.openai.com/siwc/token-sharing-open-source) and
[Claude product conditions](https://code.claude.com/docs/en/legal-and-compliance).

Native runtimes, Rust/system libraries, external panels, artwork ownership, store delivery, and
contributor agreements still need release-specific review. MPL source-access and other native
license duties are not replaced by the JavaScript notices. Development images still install the
full npm tree; resolve `pngparse` before redistributing those images. Mac packaging remains ad-hoc
signed, and iOS CI output is unsigned.

The full npm audit reported a moderate [`sprintf-js` issue](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
propagated through eight build-tool packages. No newer upstream release was available; no dependency
was forcibly downgraded. The production npm advisory query returned zero findings at audit time.

## Verification

- Web, Tauri frontend, Electron, and enterprise bundle builds; lint and Electron typecheck passed
- 34 focused permission/settings/Claude tests, 3 notice tests, and 49 enterprise tests passed
- Bundled enterprise gateway started and proxied a loopback HTTP request successfully
- SDK packaging dry run includes `LICENSE`; generated bundle notices contain project/dependency text
- All 38 web manifest entries validated against generated dimensions; maskable PNGs are opaque;
  every Android icon/resource copy matches the native source

This is an engineering audit and repair record, not legal clearance. Finished native installers,
container images, real hardware capture, and live provider egress were not verified end to end.
