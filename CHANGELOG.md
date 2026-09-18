# Changelog

## 1.0.0 (2026-09-18)


### Features

* add a Helm chart for deploying into Kubernetes ([#40](https://github.com/wdalmeida/yaml-config-generator-validator/issues/40)) ([cc190da](https://github.com/wdalmeida/yaml-config-generator-validator/commit/cc190da15593134364c0fd50e78fe460b4a45e06))
* add a second Containerfile built on Red Hat Hardened Images ([#39](https://github.com/wdalmeida/yaml-config-generator-validator/issues/39)) ([ae99352](https://github.com/wdalmeida/yaml-config-generator-validator/commit/ae9935289cbe830c26a8a8a6250bd1b3257a3976))
* add an API secret to the Kubernetes pill, and let the namespace be named ([#47](https://github.com/wdalmeida/yaml-config-generator-validator/issues/47)) ([aa90ac5](https://github.com/wdalmeida/yaml-config-generator-validator/commit/aa90ac5190392910170463cc67db2f456696ee30))
* add release automation, Renovate digest tracking, and CI hardening ([#1](https://github.com/wdalmeida/yaml-config-generator-validator/issues/1)) ([1c90349](https://github.com/wdalmeida/yaml-config-generator-validator/commit/1c903490052160471415168586bf9b87c4a946d1))
* Buildah-built OCI image, with CI that tests, scans and attests it ([#22](https://github.com/wdalmeida/yaml-config-generator-validator/issues/22)) ([6c4d896](https://github.com/wdalmeida/yaml-config-generator-validator/commit/6c4d89633f29757cd9b29df535c19d1b1405b9c9))
* fix the target filename and prefill owner/repo from the Pages URL ([#23](https://github.com/wdalmeida/yaml-config-generator-validator/issues/23)) ([0037c3e](https://github.com/wdalmeida/yaml-config-generator-validator/commit/0037c3e55b42ed7c6bd8550408d4905b08022b53))
* have Renovate manage GitHub Action pins, Docker digests, and embedded tool versions ([#14](https://github.com/wdalmeida/yaml-config-generator-validator/issues/14)) ([f107d29](https://github.com/wdalmeida/yaml-config-generator-validator/commit/f107d292a397aee9fc74bd2f58c90631fad7c6a7))
* integrate Plumber as a second GitHub Actions security scanner ([#9](https://github.com/wdalmeida/yaml-config-generator-validator/issues/9)) ([d4ae333](https://github.com/wdalmeida/yaml-config-generator-validator/commit/d4ae3339dc54e1ff87211f1ce81c35708cb2cf89))
* keep a secret entered on the Kubernetes pill out of localStorage ([#46](https://github.com/wdalmeida/yaml-config-generator-validator/issues/46)) ([9475043](https://github.com/wdalmeida/yaml-config-generator-validator/commit/9475043ad09e0c3cf6ce50cd2da655995f602a4f))
* make CD notifyChannel optional as a toggle-text example ([#21](https://github.com/wdalmeida/yaml-config-generator-validator/issues/21)) ([6585523](https://github.com/wdalmeida/yaml-config-generator-validator/commit/65855237d7895c7c33088d26d8f28aa19fe2ba36))
* make the app usable without a mouse or a screen ([#44](https://github.com/wdalmeida/yaml-config-generator-validator/issues/44)) ([a31ceba](https://github.com/wdalmeida/yaml-config-generator-validator/commit/a31cebae48226eec7930fe3e9418a1d51ed59b23))
* mask the Kubernetes API secret, in the field and the output together ([#48](https://github.com/wdalmeida/yaml-config-generator-validator/issues/48)) ([156a299](https://github.com/wdalmeida/yaml-config-generator-validator/commit/156a299bb49ab5232521b7a48fa5d009dcd366fe))
* onboarding checklist, Kubernetes resources, and a CLI/UI route switch ([#35](https://github.com/wdalmeida/yaml-config-generator-validator/issues/35)) ([57cab99](https://github.com/wdalmeida/yaml-config-generator-validator/commit/57cab99544d6a527a3773e45174e66f205ee5af1))
* scrollable YAML panel, a theme switch, and a guard on what gets stored ([#45](https://github.com/wdalmeida/yaml-config-generator-validator/issues/45)) ([e7f66b0](https://github.com/wdalmeida/yaml-config-generator-validator/commit/e7f66b055e7ff6c719cee5b45691645aa061709b))
* unify YAML input/output into one live CodeMirror field, soft-modern redesign ([#11](https://github.com/wdalmeida/yaml-config-generator-validator/issues/11)) ([6868cce](https://github.com/wdalmeida/yaml-config-generator-validator/commit/6868cce96d5dfdaffd03c4b58d7585cfa784eece))


### Bug Fixes

* correct SCA gate skip-vs-fail bug and dedupe scan-args in osv-scan.yml ([#7](https://github.com/wdalmeida/yaml-config-generator-validator/issues/7)) ([85ae3ed](https://github.com/wdalmeida/yaml-config-generator-validator/commit/85ae3edd2dc305b87dccce0af75f47b6f1443bb2))
* **deps:** pin patched transitive versions behind npm overrides ([#36](https://github.com/wdalmeida/yaml-config-generator-validator/issues/36)) ([5df51d9](https://github.com/wdalmeida/yaml-config-generator-validator/commit/5df51d93a2a3a9991fddcbc345f9e05aefc6f0ee))
* migrate off deprecated actions/attest-sbom to actions/attest ([#4](https://github.com/wdalmeida/yaml-config-generator-validator/issues/4)) ([5103051](https://github.com/wdalmeida/yaml-config-generator-validator/commit/5103051b548c0f842b555010a2e7a93183f6220b))
* **renovate:** unblock lock file maintenance PRs ([#50](https://github.com/wdalmeida/yaml-config-generator-validator/issues/50)) ([0a6799f](https://github.com/wdalmeida/yaml-config-generator-validator/commit/0a6799f0c7b4478c346bd808e96f3633d70a1fb6))
* replace anchore/sbom-action with a direct Syft install ([#10](https://github.com/wdalmeida/yaml-config-generator-validator/issues/10)) ([a6ffca6](https://github.com/wdalmeida/yaml-config-generator-validator/commit/a6ffca6fdd657426a31fddaccaed0ad479a6b595))
* resolve Renovate digest lookup failure for the actionlint custom manager ([#15](https://github.com/wdalmeida/yaml-config-generator-validator/issues/15)) ([a135655](https://github.com/wdalmeida/yaml-config-generator-validator/commit/a1356557f296a0b4012073796e3ac4324229869e))
* scan the container image itself, not its SBOM ([#24](https://github.com/wdalmeida/yaml-config-generator-validator/issues/24)) ([67867fa](https://github.com/wdalmeida/yaml-config-generator-validator/commit/67867fa459ef5972352c69c2534d7797d4822cba))
* URL-encode owner/repo/branch in GitHub create/edit file links ([#8](https://github.com/wdalmeida/yaml-config-generator-validator/issues/8)) ([c7fae45](https://github.com/wdalmeida/yaml-config-generator-validator/commit/c7fae4520c625a3ec490d0bca3de6bf94dc68dcf))


### Performance Improvements

* cache image layers and Trivy's DB, drop the OSV action's container pull ([#25](https://github.com/wdalmeida/yaml-config-generator-validator/issues/25)) ([d5eaa6b](https://github.com/wdalmeida/yaml-config-generator-validator/commit/d5eaa6b2b2ecd90534a3bfe46a9c64062a69f7a0))
* load-test the chart and document what it actually needs ([#41](https://github.com/wdalmeida/yaml-config-generator-validator/issues/41)) ([5118f53](https://github.com/wdalmeida/yaml-config-generator-validator/commit/5118f53eff19a73ec68e895934908ab7903a1931))
