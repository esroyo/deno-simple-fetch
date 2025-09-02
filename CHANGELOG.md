### [0.1.5](https://github.com/esroyo/deno-simple-fetch/compare/v0.1.4...v0.1.5) (2025.09.02)

- fix: make connection reusable after a chunked req
  ([c979ede](https://github.com/esroyo/deno-simple-fetch/commit/c979ede598b0abf5ec1fe2fe7362acab299ba047))

### [0.1.4](https://github.com/esroyo/deno-simple-fetch/compare/v0.1.3...v0.1.4) (2025.09.02)

- fix: handle lenient line endings (without CR)
  ([39d95d8](https://github.com/esroyo/deno-simple-fetch/commit/39d95d8011705d6fc95050be1dc97d1cef6041e6))

### [0.1.3](https://github.com/esroyo/deno-simple-fetch/compare/v0.1.2...v0.1.3) (2025.09.02)

- fix: avoid throw when request is aborted and body locked
  ([c500647](https://github.com/esroyo/deno-simple-fetch/commit/c500647c2218063d8591127f843809cf8a1f4c7d))

### [0.1.2](https://github.com/esroyo/deno-simple-fetch/compare/v0.1.1...v0.1.2) (2025.08.21)

- fix: add missing asyncDispose in the fetch type
  ([ec6a1f8](https://github.com/esroyo/deno-simple-fetch/commit/ec6a1f865f3b07bbca87b1056a37fd7ab538abff))
- chore: adopt deno-bump-workspaces as release tool
  ([cd3c0e6](https://github.com/esroyo/deno-simple-fetch/commit/cd3c0e6c026f34275a44ac432f6a8f22893fe948))

### [0.1.1](https://github.com/esroyo/deno-simple-fetch/compare/v0.1.0...v0.1.1) (2025.08.13)

- fix: correct exported symbols
  ([5f5cafa](https://github.com/esroyo/deno-simple-fetch/commit/5f5cafaa21bc624e14ff84b9c58456c9d8bad593))

### [0.1.0](https://github.com/esroyo/deno-simple-fetch/compare/v0.0.0...v0.1.0) (2025.08.13)

- feat: add pool and tests
  ([0677710](https://github.com/esroyo/deno-simple-fetch/commit/0677710953fd9ac84365ec03e7129bcc9b099795))
- feat: allow to pass an HttpClient to createFetch
  ([2e3a4c5](https://github.com/esroyo/deno-simple-fetch/commit/2e3a4c58e63aba4664c9d2b915a95e16b63cf44b))
- feat: allow to pass pool options in HttpClient
  ([8c2cd53](https://github.com/esroyo/deno-simple-fetch/commit/8c2cd538e258e051a52e6b375aa708ff449d4a95))
- feat: clean-up agent connection when responses are GC
  ([b02fe37](https://github.com/esroyo/deno-simple-fetch/commit/b02fe3709b768d771c6debf313d8497f93ab8650))
- feat: fetch API like
  ([3fb980a](https://github.com/esroyo/deno-simple-fetch/commit/3fb980a8ac6b6968c58698b788a704a519858076))
- fix: correct pool options to avoid hard evition
  ([9fa85cd](https://github.com/esroyo/deno-simple-fetch/commit/9fa85cd9c1824efd6bf48dca932166dd04a90eba))
- fix: make all Deno.conn readers lazy
  ([6f9073e](https://github.com/esroyo/deno-simple-fetch/commit/6f9073e9303ad11e91417a48217812515b14de92))
- chore: break up HttpClient and fetch
  ([37269ce](https://github.com/esroyo/deno-simple-fetch/commit/37269cedd12d049572ad4d4584cbdb45ac95b714))
- chore: factorize state manipulation
  ([a1c0883](https://github.com/esroyo/deno-simple-fetch/commit/a1c0883d97c81adc9541d64126e07b879f3dbcc7))
- chore: make use of standard Response
  ([f50fd0d](https://github.com/esroyo/deno-simple-fetch/commit/f50fd0d7a74b24bfbbd94e8a05908e16d1968f73))
- chore: remove redundant lines
  ([17b2538](https://github.com/esroyo/deno-simple-fetch/commit/17b2538bcf5fb131730a8b08da276858739493b7))
