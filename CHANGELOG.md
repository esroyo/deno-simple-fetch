# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## 0.1.0 (2025-08-13)


### Features

* add pool and tests ([0677710](https://github.com/esroyo/deno-simple-fetch/commit/0677710953fd9ac84365ec03e7129bcc9b099795))
* allow to pass an HttpClient to createFetch ([2e3a4c5](https://github.com/esroyo/deno-simple-fetch/commit/2e3a4c58e63aba4664c9d2b915a95e16b63cf44b))
* allow to pass pool options in HttpClient ([8c2cd53](https://github.com/esroyo/deno-simple-fetch/commit/8c2cd538e258e051a52e6b375aa708ff449d4a95))
* clean-up agent connection when responses are GC ([b02fe37](https://github.com/esroyo/deno-simple-fetch/commit/b02fe3709b768d771c6debf313d8497f93ab8650))
* fetch API like ([3fb980a](https://github.com/esroyo/deno-simple-fetch/commit/3fb980a8ac6b6968c58698b788a704a519858076))


### Bug Fixes

* correct pool options to avoid hard evition ([9fa85cd](https://github.com/esroyo/deno-simple-fetch/commit/9fa85cd9c1824efd6bf48dca932166dd04a90eba))
* make all Deno.conn readers lazy ([6f9073e](https://github.com/esroyo/deno-simple-fetch/commit/6f9073e9303ad11e91417a48217812515b14de92))


### Other

* break up HttpClient and fetch ([37269ce](https://github.com/esroyo/deno-simple-fetch/commit/37269cedd12d049572ad4d4584cbdb45ac95b714))
* factorize state manipulation ([a1c0883](https://github.com/esroyo/deno-simple-fetch/commit/a1c0883d97c81adc9541d64126e07b879f3dbcc7))
* make use of standard Response ([f50fd0d](https://github.com/esroyo/deno-simple-fetch/commit/f50fd0d7a74b24bfbbd94e8a05908e16d1968f73))
* remove redundant lines ([17b2538](https://github.com/esroyo/deno-simple-fetch/commit/17b2538bcf5fb131730a8b08da276858739493b7))
