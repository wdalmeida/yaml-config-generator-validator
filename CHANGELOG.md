# Changelog

## 1.0.0 (2026-08-24)


### Features

* add release automation, Renovate digest tracking, and CI hardening ([#1](https://github.com/wdalmeida/yaml-config-generator-validator/issues/1)) ([1c90349](https://github.com/wdalmeida/yaml-config-generator-validator/commit/1c903490052160471415168586bf9b87c4a946d1))
* Buildah-built OCI image, with CI that tests, scans and attests it ([#22](https://github.com/wdalmeida/yaml-config-generator-validator/issues/22)) ([6c4d896](https://github.com/wdalmeida/yaml-config-generator-validator/commit/6c4d89633f29757cd9b29df535c19d1b1405b9c9))
* fix the target filename and prefill owner/repo from the Pages URL ([#23](https://github.com/wdalmeida/yaml-config-generator-validator/issues/23)) ([0037c3e](https://github.com/wdalmeida/yaml-config-generator-validator/commit/0037c3e55b42ed7c6bd8550408d4905b08022b53))
* have Renovate manage GitHub Action pins, Docker digests, and embedded tool versions ([#14](https://github.com/wdalmeida/yaml-config-generator-validator/issues/14)) ([f107d29](https://github.com/wdalmeida/yaml-config-generator-validator/commit/f107d292a397aee9fc74bd2f58c90631fad7c6a7))
* integrate Plumber as a second GitHub Actions security scanner ([#9](https://github.com/wdalmeida/yaml-config-generator-validator/issues/9)) ([d4ae333](https://github.com/wdalmeida/yaml-config-generator-validator/commit/d4ae3339dc54e1ff87211f1ce81c35708cb2cf89))
* make CD notifyChannel optional as a toggle-text example ([#21](https://github.com/wdalmeida/yaml-config-generator-validator/issues/21)) ([6585523](https://github.com/wdalmeida/yaml-config-generator-validator/commit/65855237d7895c7c33088d26d8f28aa19fe2ba36))
* unify YAML input/output into one live CodeMirror field, soft-modern redesign ([#11](https://github.com/wdalmeida/yaml-config-generator-validator/issues/11)) ([6868cce](https://github.com/wdalmeida/yaml-config-generator-validator/commit/6868cce96d5dfdaffd03c4b58d7585cfa784eece))


### Bug Fixes

* correct SCA gate skip-vs-fail bug and dedupe scan-args in osv-scan.yml ([#7](https://github.com/wdalmeida/yaml-config-generator-validator/issues/7)) ([85ae3ed](https://github.com/wdalmeida/yaml-config-generator-validator/commit/85ae3edd2dc305b87dccce0af75f47b6f1443bb2))
* migrate off deprecated actions/attest-sbom to actions/attest ([#4](https://github.com/wdalmeida/yaml-config-generator-validator/issues/4)) ([5103051](https://github.com/wdalmeida/yaml-config-generator-validator/commit/5103051b548c0f842b555010a2e7a93183f6220b))
* replace anchore/sbom-action with a direct Syft install ([#10](https://github.com/wdalmeida/yaml-config-generator-validator/issues/10)) ([a6ffca6](https://github.com/wdalmeida/yaml-config-generator-validator/commit/a6ffca6fdd657426a31fddaccaed0ad479a6b595))
* resolve Renovate digest lookup failure for the actionlint custom manager ([#15](https://github.com/wdalmeida/yaml-config-generator-validator/issues/15)) ([a135655](https://github.com/wdalmeida/yaml-config-generator-validator/commit/a1356557f296a0b4012073796e3ac4324229869e))
* scan the container image itself, not its SBOM ([#24](https://github.com/wdalmeida/yaml-config-generator-validator/issues/24)) ([67867fa](https://github.com/wdalmeida/yaml-config-generator-validator/commit/67867fa459ef5972352c69c2534d7797d4822cba))
* URL-encode owner/repo/branch in GitHub create/edit file links ([#8](https://github.com/wdalmeida/yaml-config-generator-validator/issues/8)) ([c7fae45](https://github.com/wdalmeida/yaml-config-generator-validator/commit/c7fae4520c625a3ec490d0bca3de6bf94dc68dcf))


### Performance Improvements

* cache image layers and Trivy's DB, drop the OSV action's container pull ([#25](https://github.com/wdalmeida/yaml-config-generator-validator/issues/25)) ([d5eaa6b](https://github.com/wdalmeida/yaml-config-generator-validator/commit/d5eaa6b2b2ecd90534a3bfe46a9c64062a69f7a0))
