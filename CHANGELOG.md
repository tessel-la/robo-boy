# Changelog

## [0.21.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.20.0-alpha...robo-boy-v0.21.0-alpha) (2026-11-08)


### Features

* show backend versions and warn about release mismatches ([#257](https://github.com/tessel-la/robo-boy/issues/257)) ([4b72486](https://github.com/tessel-la/robo-boy/commit/4b72486b9d2e837ec1cb6364c723746371aa7c92))

## [0.20.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.19.0-alpha...robo-boy-v0.20.0-alpha) (2026-11-07)


### Features

* **3d:** add movable joint state telemetry overlay ([#245](https://github.com/tessel-la/robo-boy/issues/245)) ([02480b3](https://github.com/tessel-la/robo-boy/commit/02480b3db7cbd8f8de2ed36ee2d00511ac0f968d))
* **3d:** add path and occupancy grid layers ([#237](https://github.com/tessel-la/robo-boy/issues/237)) ([0a04572](https://github.com/tessel-la/robo-boy/commit/0a0457289952ad2708cd9acb3f3ce0f508337d7b))
* **3d:** display calibrated camera image planes ([#239](https://github.com/tessel-la/robo-boy/issues/239)) ([50511dc](https://github.com/tessel-la/robo-boy/commit/50511dcab471297bbff86ee674841b5a5b691e75))
* **3d:** inspect cameras and project images onto mesh surfaces ([#248](https://github.com/tessel-la/robo-boy/issues/248)) ([98fec9e](https://github.com/tessel-la/robo-boy/commit/98fec9e95f153783ee55bf5a4c7ec98d0663c81d))
* **3d:** render incremental Nav2 costmaps ([#246](https://github.com/tessel-la/robo-boy/issues/246)) ([8973845](https://github.com/tessel-la/robo-boy/commit/8973845786b6225a22256c7b8bb20e1d8e5583a0))
* add compressed point-cloud streaming and depth camera views ([#251](https://github.com/tessel-la/robo-boy/issues/251)) ([e066c2f](https://github.com/tessel-la/robo-boy/commit/e066c2f40d93b8358ca4a7115e54e444fc2bad1d))
* add reviewed ROS 2 parameter editing to Data Explorer ([#235](https://github.com/tessel-la/robo-boy/issues/235)) ([48ce462](https://github.com/tessel-la/robo-boy/commit/48ce46272ba35b38996203f1c09bb0b86476a469))
* **assistant:** native agent runtime, scoped tools and autonomous authoring ([#225](https://github.com/tessel-la/robo-boy/issues/225)) ([7927f81](https://github.com/tessel-la/robo-boy/commit/7927f81cbe19b21d48906705b4920faf6abac04d))
* **camera:** share timestamped MJPEG streams between Camera and 3D ([#240](https://github.com/tessel-la/robo-boy/issues/240)) ([a7619d2](https://github.com/tessel-la/robo-boy/commit/a7619d2e1605d331db2e8febbc36343d9837cddd))
* **camera:** share WHEP sources and configure 3D projection rate ([#241](https://github.com/tessel-la/robo-boy/issues/241)) ([9df9af6](https://github.com/tessel-la/robo-boy/commit/9df9af6d5bfe7009dc08ef3ba294532ca1c2fc73))
* custom login and branding ([#230](https://github.com/tessel-la/robo-boy/issues/230)) ([7506921](https://github.com/tessel-la/robo-boy/commit/7506921da5b5baa670d34768f6632a048109b779))
* customize company login copy and improve connection history ([#232](https://github.com/tessel-la/robo-boy/issues/232)) ([89ef22d](https://github.com/tessel-la/robo-boy/commit/89ef22d07892e72780c61e8d0c9863c202788a43))
* **plotting:** add xy plots and interval statistics ([#249](https://github.com/tessel-la/robo-boy/issues/249)) ([1371423](https://github.com/tessel-la/robo-boy/commit/1371423fa8501a5bddd721057ccecd4e3dbac983))
* **sdk:** add panel actions and control requests ([#252](https://github.com/tessel-la/robo-boy/issues/252)) ([259c33f](https://github.com/tessel-la/robo-boy/commit/259c33f2bbdfa51af5c481c8639542851182f6d4))


### Bug Fixes

* **3d:** bring every layer's settings into the menu's design language ([#244](https://github.com/tessel-la/robo-boy/issues/244)) ([99a3053](https://github.com/tessel-la/robo-boy/commit/99a305352e24ad6ceb93411bbae9bceb672a62ed))
* **3d:** correct spatial rendering, frame styling and web mesh loading ([#236](https://github.com/tessel-la/robo-boy/issues/236)) ([b8ca38f](https://github.com/tessel-la/robo-boy/commit/b8ca38fa422f3fb2fc702c9b0283e62079189d15))
* **assistant:** align mobile mode and model control heights ([#242](https://github.com/tessel-la/robo-boy/issues/242)) ([d93a1c7](https://github.com/tessel-la/robo-boy/commit/d93a1c703bb5b8946de4ab1b9ad807c4006b6b19))
* clean up unused code and patch vulnerable dependencies ([#233](https://github.com/tessel-la/robo-boy/issues/233)) ([612b8a0](https://github.com/tessel-la/robo-boy/commit/612b8a0102dca4b68af7ba393e1b466f501ca06e))
* **control:** release stale owners and recover unstarted actions ([#243](https://github.com/tessel-la/robo-boy/issues/243)) ([a797ce1](https://github.com/tessel-la/robo-boy/commit/a797ce1d48b1fbb587919a0000d40e2e9ebec957))
* keep separators while typing comma-separated pad settings ([#229](https://github.com/tessel-la/robo-boy/issues/229)) ([4945016](https://github.com/tessel-la/robo-boy/commit/49450164f3af9fed79dff99c784d3919867ce3e6))
* retire the external time series panel ([#238](https://github.com/tessel-la/robo-boy/issues/238)) ([068183f](https://github.com/tessel-la/robo-boy/commit/068183fbadf5e2c421e2f2218adf75528f85a9c2))
* round the app icon's corners on every platform ([#247](https://github.com/tessel-la/robo-boy/issues/247)) ([2077bc7](https://github.com/tessel-la/robo-boy/commit/2077bc781b1b8f1afda78a528db70a17a7ea8c38))
* ship license notices and repair deployment audit findings ([#231](https://github.com/tessel-la/robo-boy/issues/231)) ([18199f8](https://github.com/tessel-la/robo-boy/commit/18199f869ea6db42ef2acb1362c062402508f9cf))
* show one surprise message per login visit ([#234](https://github.com/tessel-la/robo-boy/issues/234)) ([534cb28](https://github.com/tessel-la/robo-boy/commit/534cb287d0c07645527b5b8592023ba75597d27f))
* update follow-redirects to prevent credential leaks ([#254](https://github.com/tessel-la/robo-boy/issues/254)) ([652d6fc](https://github.com/tessel-la/robo-boy/commit/652d6fcfdf452632fe35f95b3061304cb791c990))

## [0.19.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.18.0-alpha...robo-boy-v0.19.0-alpha) (2026-10-14)


### Features

* control observer services ([#226](https://github.com/tessel-la/robo-boy/issues/226)) ([fa14430](https://github.com/tessel-la/robo-boy/commit/fa14430d1cfb146a055b204dc83c50411becfab1))
* robot control ownership ([#222](https://github.com/tessel-la/robo-boy/issues/222)) ([50be40a](https://github.com/tessel-la/robo-boy/commit/50be40a8a4b3e1b041622599f6b0e707dce78c03))
* robot control ownership and observer services, plus camera and assistant launcher fixes ([7b10a3b](https://github.com/tessel-la/robo-boy/commit/7b10a3b7614e32b8444fbd6ce72d5f1ef5456068))


### Bug Fixes

* camera topic refresh ([#223](https://github.com/tessel-la/robo-boy/issues/223)) ([f23f8fc](https://github.com/tessel-la/robo-boy/commit/f23f8fc34823a2cd508bf2016b6b7760c05d04ed))
* keep assistant launcher anchored and settings header accessible ([#224](https://github.com/tessel-la/robo-boy/issues/224)) ([2b9ff43](https://github.com/tessel-la/robo-boy/commit/2b9ff4302b105cda7b30e18188541d7f7487e387))

## [0.18.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.17.0-alpha...robo-boy-v0.18.0-alpha) (2026-10-05)


### Features

* let the AI assistant use the Data Explorer, Record & Replay and more of the app ([#219](https://github.com/tessel-la/robo-boy/issues/219)) ([b608bb0](https://github.com/tessel-la/robo-boy/commit/b608bb002fb2d95cae7f6fab204e0de8aeb98717))
* subscription agent auth ([#218](https://github.com/tessel-la/robo-boy/issues/218)) ([14ed8f0](https://github.com/tessel-la/robo-boy/commit/14ed8f0186ead33d02f3cfb175050e1acf57464f))


### Bug Fixes

* align README platforms and patch vulnerable dependencies ([#215](https://github.com/tessel-la/robo-boy/issues/215)) ([e66a1f5](https://github.com/tessel-la/robo-boy/commit/e66a1f5107b4077b1b8d4d0425aa845ca072247b))
* **electron:** verify public TLS certificates and panel downloads ([#214](https://github.com/tessel-la/robo-boy/issues/214)) ([f9c1dbf](https://github.com/tessel-la/robo-boy/commit/f9c1dbfd1f8b86c62decf78bad543e6af5820c77))
* keep the diagnostics view from crashing over plain http ([#213](https://github.com/tessel-la/robo-boy/issues/213)) ([61bb1e8](https://github.com/tessel-la/robo-boy/commit/61bb1e861f472e646fda3a327cd7318b9319b28e))
* preserve empty workspaces on reconnect ([#216](https://github.com/tessel-la/robo-boy/issues/216)) ([8b78fa0](https://github.com/tessel-la/robo-boy/commit/8b78fa03b21ff6a3da4cb77e071be37ceaf547b4))
* wait for a current inspector graph before listing behavior-tree actions ([#217](https://github.com/tessel-la/robo-boy/issues/217)) ([9378813](https://github.com/tessel-la/robo-boy/commit/93788138337a61dd80cfed2a1f23b2323d6d3532))

## [0.17.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.16.0-alpha...robo-boy-v0.17.0-alpha) (2026-10-01)


### Features

* frame published robot ports directly in the desktop app ([#209](https://github.com/tessel-la/robo-boy/issues/209)) ([691bd94](https://github.com/tessel-la/robo-boy/commit/691bd9466310bde228e7925b46b9b5e186b04755))
* lighter camera streams and revalidated mesh cache ([#210](https://github.com/tessel-la/robo-boy/issues/210)) ([eee19bb](https://github.com/tessel-la/robo-boy/commit/eee19bb0744838dbd8292761c8e58f092c54a1b3))


### Bug Fixes

* keep workspace window borders inside layout bounds ([#208](https://github.com/tessel-la/robo-boy/issues/208)) ([3bda90e](https://github.com/tessel-la/robo-boy/commit/3bda90eedf9f04eed222f8007f6721536ad2115e))

## [0.16.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.15.0-alpha...robo-boy-v0.16.0-alpha) (2026-09-30)


### Features

* add gauge, level, readout, state, setpoint and text pad components ([#200](https://github.com/tessel-la/robo-boy/issues/200)) ([44e22ba](https://github.com/tessel-la/robo-boy/commit/44e22bac9cdda6fe237a795cc66ff85a207600ac))
* add the Data Explorer panel ([#204](https://github.com/tessel-la/robo-boy/issues/204)) ([b28856d](https://github.com/tessel-la/robo-boy/commit/b28856d82d889dc2fb372b9253c6f551b72c8be3))
* build the Electron app for Apple Silicon Macs ([#199](https://github.com/tessel-la/robo-boy/issues/199)) ([25cfbad](https://github.com/tessel-la/robo-boy/commit/25cfbad9d5c5513093557d4725717cc90b8337f7))
* data Explorer panel, richer behavior tree inspection, new pad components and faster rosbridge ([b4b0d94](https://github.com/tessel-la/robo-boy/commit/b4b0d948e8f749c4c4af263808a5ea61ae95b006))
* inspect behavior tree action and service results, feedback, images and failures ([#201](https://github.com/tessel-la/robo-boy/issues/201)) ([9143dc3](https://github.com/tessel-la/robo-boy/commit/9143dc3d468ca7326193e7360f26a371f36846b1))


### Bug Fixes

* default the 3D panel's frame label size to 0.05 m ([#198](https://github.com/tessel-la/robo-boy/issues/198)) ([1341c6f](https://github.com/tessel-la/robo-boy/commit/1341c6fc56b7bd2c6c72637d20a7201585d44f07))
* load remote robot assets through native desktop transport ([#202](https://github.com/tessel-la/robo-boy/issues/202)) ([f1937fe](https://github.com/tessel-la/robo-boy/commit/f1937fea7c718baebe1af46354c857d3b4931744))
* route panel /&lt;port&gt;/ frames to the robot in the Electron shell ([#203](https://github.com/tessel-la/robo-boy/issues/203)) ([80250fc](https://github.com/tessel-la/robo-boy/commit/80250fc4a7792b04d8852e1a97d4f0fea74b1f27))


### Performance Improvements

* keep rosbridge responsive on busy cells and remote links ([#205](https://github.com/tessel-la/robo-boy/issues/205)) ([ec44e16](https://github.com/tessel-la/robo-boy/commit/ec44e16f304f65bee33be997a52d2062092d81ea))

## [0.15.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.14.0-alpha...robo-boy-v0.15.0-alpha) (2026-09-28)


### Features

* redesign pad editing controls and fit new components to the room ([#195](https://github.com/tessel-la/robo-boy/issues/195)) ([2b6741e](https://github.com/tessel-la/robo-boy/commit/2b6741ecb951c0e34c2ef924aa3c0e78c0b5ed21))
* show the workspace opening and the link to the robot ([#194](https://github.com/tessel-la/robo-boy/issues/194)) ([da92f92](https://github.com/tessel-la/robo-boy/commit/da92f92fe39a40f683f01d09d5faa0c3c6a029f6))
* workspace opening screen and pad editor redesign ([f53ef14](https://github.com/tessel-la/robo-boy/commit/f53ef14c93df65121e555f236689ea207cb79d21))

## [0.14.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.13.0-alpha...robo-boy-v0.14.0-alpha) (2026-09-27)


### Features

* **assistant:** configure the Time Series panel from chat ([#184](https://github.com/tessel-la/robo-boy/issues/184)) ([ed44313](https://github.com/tessel-la/robo-boy/commit/ed44313ebf78fff942f55276fa23c5649e2385a6))
* **assistant:** polish panel interactions ([#181](https://github.com/tessel-la/robo-boy/issues/181)) ([8848292](https://github.com/tessel-la/robo-boy/commit/88482926d7062cd32c74ab1483e8db46977d9172))
* better ux mobile assistant ([#188](https://github.com/tessel-la/robo-boy/issues/188)) ([be2cd36](https://github.com/tessel-la/robo-boy/commit/be2cd36d6100dd4e9635a251abb106a353731b3d))
* guide the first panel from the empty workspace ([#190](https://github.com/tessel-la/robo-boy/issues/190)) ([c07fe66](https://github.com/tessel-la/robo-boy/commit/c07fe66e2736c8c00616bf9da6b1bef7ffa59922))
* native timeseries panel ([#180](https://github.com/tessel-la/robo-boy/issues/180)) ([bfead90](https://github.com/tessel-la/robo-boy/commit/bfead90b67ddb3faccb8cbc64c51bdac5b84faaa))
* record & replay panel ([#183](https://github.com/tessel-la/robo-boy/issues/183)) ([7d53956](https://github.com/tessel-la/robo-boy/commit/7d53956a4e0ddb1cef2d11b9dc3f7752971a17c6))
* record & replay, time series, remote recordings and desktop updates ([180b773](https://github.com/tessel-la/robo-boy/commit/180b773513376006c3a9e0e745648df81c147c15))
* replay and download recordings from the ROS host ([#189](https://github.com/tessel-la/robo-boy/issues/189)) ([8a2059d](https://github.com/tessel-la/robo-boy/commit/8a2059d71433fbe8ca2ca6381a2214fdf25c4627))
* service response normalization ([#178](https://github.com/tessel-la/robo-boy/issues/178)) ([788a915](https://github.com/tessel-la/robo-boy/commit/788a915823dc123b03c6ecbe638a35d00d82d340))
* update the desktop app from inside it ([#191](https://github.com/tessel-la/robo-boy/issues/191)) ([c346036](https://github.com/tessel-la/robo-boy/commit/c346036dee099cded58366c3cd8905f8b86c38dd))


### Bug Fixes

* patch vulnerable npm and Rust dependencies ([#182](https://github.com/tessel-la/robo-boy/issues/182)) ([f7465ec](https://github.com/tessel-la/robo-boy/commit/f7465ecea07dc544bea4d5e806eda03b03b4f60a))
* preserve saved ports in desktop quick connect ([#179](https://github.com/tessel-la/robo-boy/issues/179)) ([88b7f1b](https://github.com/tessel-la/robo-boy/commit/88b7f1bd88b4a25a6bda2df43c6ba722313f0a8b))
* release camera streams and add Firefox regression coverage ([#185](https://github.com/tessel-la/robo-boy/issues/185)) ([208d76a](https://github.com/tessel-la/robo-boy/commit/208d76af48cf147afc6dff26b1d1226f9915cb4a))
* start recordings over insecure HTTP ([#186](https://github.com/tessel-la/robo-boy/issues/186)) ([885a2a4](https://github.com/tessel-la/robo-boy/commit/885a2a4f89f4a757e922764684c5e40ce9459600))

## [0.13.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.12.0-alpha...robo-boy-v0.13.0-alpha) (2026-09-23)


### Features

* caddy reroute for embedding view ([#170](https://github.com/tessel-la/robo-boy/issues/170)) ([ca9e572](https://github.com/tessel-la/robo-boy/commit/ca9e572d39faf3ebe4b0f249b985f4cf232f44e6))
* marker array support ([#171](https://github.com/tessel-la/robo-boy/issues/171)) ([2cabf1d](https://github.com/tessel-la/robo-boy/commit/2cabf1d70848005d82a730e77ab99ee4a77285ed))


### Bug Fixes

* **bt:** open node settings on touch double tap ([#172](https://github.com/tessel-la/robo-boy/issues/172)) ([751352c](https://github.com/tessel-la/robo-boy/commit/751352c50930caaa5efaf7f045b93e70a6fa5cbf))
* **desktop:** enable pad drag and drop on Windows ([#173](https://github.com/tessel-la/robo-boy/issues/173)) ([0271334](https://github.com/tessel-la/robo-boy/commit/0271334b2611a2585e319e59a09a4b907cf01041))

## [0.12.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.11.0-alpha...robo-boy-v0.12.0-alpha) (2026-09-21)


### Features

* **assistant:** let the assistant edit the workspace ([#162](https://github.com/tessel-la/robo-boy/issues/162)) ([cc36531](https://github.com/tessel-la/robo-boy/commit/cc36531db2a402a5978ca153b96ba604f835f811))


### Bug Fixes

* **ci:** build and release Electron Linux for x64 and arm64 ([#167](https://github.com/tessel-la/robo-boy/issues/167)) ([396e82c](https://github.com/tessel-la/robo-boy/commit/396e82cba340a5308bc8e19015aa175c00c6d8cb))

## [0.11.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.10.0-alpha...robo-boy-v0.11.0-alpha) (2026-09-21)


### Features

* **3d:** TF opacity and label background settings, carried by layout export ([92f7d11](https://github.com/tessel-la/robo-boy/commit/92f7d11f1c567dd111c525702a6c993fe3082b52))
* electron linux desktop ([#164](https://github.com/tessel-la/robo-boy/issues/164)) ([3db56b1](https://github.com/tessel-la/robo-boy/commit/3db56b1ea81490b94bd14ddcca280660f33e1c2b))
* electron linux desktop and 3d panel improvements([#164](https://github.com/tessel-la/robo-boy/issues/164)) ([f6e6bcc](https://github.com/tessel-la/robo-boy/commit/f6e6bcc907d269fdfc4c3efebae362e450a7f7f9))


### Bug Fixes

* **3d:** keep TF axes across viewer rebuilds and rework frame settings ([6705c3a](https://github.com/tessel-la/robo-boy/commit/6705c3a70e2dd04d3b9f1c645491060b842d4cb2))
* **3d:** keep TF axes across viewer rebuilds, rework frame settings, grab-style pan ([3e55b74](https://github.com/tessel-la/robo-boy/commit/3e55b74d9bf61bc27327e13369641babd9edf71e))
* **assistant:** dock the panel on the launcher's side ([5709a81](https://github.com/tessel-la/robo-boy/commit/5709a81537ba81e1dcc4fe779cedb47cae97b595))
* **dev-server:** allow serving under configured hostnames ([7b6f0e2](https://github.com/tessel-la/robo-boy/commit/7b6f0e224026b5cc0ec699f217ad14d39932534d))

## [0.10.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.9.3-alpha...robo-boy-v0.10.0-alpha) (2026-09-16)


### Features

* add the webxr panel capability and panel SDK 2.2.0 ([d2df8f4](https://github.com/tessel-la/robo-boy/commit/d2df8f4323e80043a7c76a00cabed178d3b95d80))
* vr panel webxr capability ([#155](https://github.com/tessel-la/robo-boy/issues/155)) ([ab25f5b](https://github.com/tessel-la/robo-boy/commit/ab25f5bcd460dfc8ed44091d8f9ecad2d38c1dd3))

## [0.9.3-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.9.2-alpha...robo-boy-v0.9.3-alpha) (2026-09-15)


### Bug Fixes

* make new behavior tree action reliable ([d17867a](https://github.com/tessel-la/robo-boy/commit/d17867a664d95eb573288d06b11d812793da55cd))
* make new behavior tree action reliable ([53fa149](https://github.com/tessel-la/robo-boy/commit/53fa1491b6179820a63ce518207a7e8918c7cecc))

## [0.9.2-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.9.1-alpha...robo-boy-v0.9.2-alpha) (2026-09-15)


### Bug Fixes

* solved a stale 3d panel ([#149](https://github.com/tessel-la/robo-boy/issues/149)) ([f975180](https://github.com/tessel-la/robo-boy/commit/f975180f25a04653faae7f1d376d4bc9c248424c))

## [0.9.1-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.9.0-alpha...robo-boy-v0.9.1-alpha) (2026-09-14)


### Bug Fixes

* **ci:** stop asking the Android SDK for the withdrawn tools package ([#146](https://github.com/tessel-la/robo-boy/issues/146)) ([ff3ec50](https://github.com/tessel-la/robo-boy/commit/ff3ec50d064f0dd27472e46eaf733a76d1f1fd1a))
* **ci:** stop asking the Android SDK for the withdrawn tools package ([#146](https://github.com/tessel-la/robo-boy/issues/146)) ([e000704](https://github.com/tessel-la/robo-boy/commit/e00070421253405801a5baa9466d91109c635448))

## [0.9.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.8.0-alpha...robo-boy-v0.9.0-alpha) (2026-09-14)


### Features

* add global AI assistant and multi-connection workspaces ([4df31b5](https://github.com/tessel-la/robo-boy/commit/4df31b546068fc997fc07cf786f817548d5d35be))
* add possibility to enstablish multiple connections and minor ui adjustments ([#140](https://github.com/tessel-la/robo-boy/issues/140)) ([8b1e716](https://github.com/tessel-la/robo-boy/commit/8b1e7167ff16c52ccd1732bf68c1446913df3b85))
* derive the assistant's self-description from the code that implements it ([3e11522](https://github.com/tessel-la/robo-boy/commit/3e1152260e6dd30e2c45f077e6c30b919085cc0d))
* improve workspace panel tiling ([#139](https://github.com/tessel-la/robo-boy/issues/139)) ([45dd38f](https://github.com/tessel-la/robo-boy/commit/45dd38f233043c7f69551a76bf89e2ed41fd1b57))
* load everything as context and drop the context bar ([4b8978e](https://github.com/tessel-la/robo-boy/commit/4b8978e78abba19d5bfd06ed728b98bff5bf5c2f))
* make assistant context tagging and mobile layout hold up in use ([050bd90](https://github.com/tessel-la/robo-boy/commit/050bd900c9e667b7ec47f24d29b2c19c48a41048))
* make the assistant panel handle media, tagging and its own chrome properly ([e74dc37](https://github.com/tessel-la/robo-boy/commit/e74dc3725ae4e4715502877239c546ed97c4db24))
* move theme controls into session menu ([#141](https://github.com/tessel-la/robo-boy/issues/141)) ([e037f42](https://github.com/tessel-la/robo-boy/commit/e037f4256918f66a29bae339426f5c3e413a775a))
* name the panel Robo-Boy AI and say what to ask it ([99444ea](https://github.com/tessel-la/robo-boy/commit/99444ea7e476381ddbf574874904a7047edc152e))
* replace BT-owned AI assistant with a global assistant ([9354522](https://github.com/tessel-la/robo-boy/commit/93545226efa93a9920877c21a556b4c1b065dbb6))
* replace BT-owned AI assistant with a global assistant ([2793d22](https://github.com/tessel-la/robo-boy/commit/2793d2251bcc96ca58ce3521165893404d57f896))
* say what to ask Robo-Boy AI for in the empty state ([b00f2ef](https://github.com/tessel-la/robo-boy/commit/b00f2eff00a57b49f84fe0779b8851fef9833a5b))
* separate choosing context from tagging it, and fix voice on mobile ([a5a844d](https://github.com/tessel-la/robo-boy/commit/a5a844dc638e400dbc5477581f05f68c01c5929f))


### Bug Fixes

* dress the status bar strip in the navbar colour ([#143](https://github.com/tessel-la/robo-boy/issues/143)) ([60fb193](https://github.com/tessel-la/robo-boy/commit/60fb19325fc93603c580fd0a3afd88e19645bdf6))
* fold panels into the bulk Pad tag instead of a group of their own ([08d6a66](https://github.com/tessel-la/robo-boy/commit/08d6a6629ec1d2057172ce597e8dc49b44910bfd))
* improved performance for 3d panel ([#142](https://github.com/tessel-la/robo-boy/issues/142)) ([2d34e6e](https://github.com/tessel-la/robo-boy/commit/2d34e6e6e5c2eac90e3aeebeea974369ec5d56cb))
* keep a tagged resource readable inside the user's own message bubble ([7fc6657](https://github.com/tessel-la/robo-boy/commit/7fc665782b12e2b552ef9d769323bd7910bfe7b7))
* say which request failed, and let voice input pick its language ([73432c5](https://github.com/tessel-la/robo-boy/commit/73432c57e7541e072d7c4d276d56fb696ab64649))
* tag from the message editor, and keep both floating buttons level ([a876435](https://github.com/tessel-la/robo-boy/commit/a8764359dba2439473bbdae7f3772207de77d275))

## [0.8.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.7.0-alpha...robo-boy-v0.8.0-alpha) (2026-09-07)


### Features

* polish external panel manager UI and responsiveness ([3a64379](https://github.com/tessel-la/robo-boy/commit/3a643795841c7631f17caa549ea249b3c7db8992))

## [0.7.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.6.1-alpha...robo-boy-v0.7.0-alpha) (2026-09-07)


### Features

* add configurable physical gamepad ([34adc85](https://github.com/tessel-la/robo-boy/commit/34adc855661cf97fb7ab5a05e23cbc6b94475b53))
* add configurable physical gamepad ([683e5ee](https://github.com/tessel-la/robo-boy/commit/683e5ee579394db273e5a7f7b7fc48d3d1788ec2))
* configure physical gamepad publish rate ([026c5c1](https://github.com/tessel-la/robo-boy/commit/026c5c1376eab82fcb97f1414a63944cc9e56c66))
* decouple WebRTC stream gateway ([#131](https://github.com/tessel-la/robo-boy/issues/131)) ([19e4153](https://github.com/tessel-la/robo-boy/commit/19e415385e97cf8d9d32318f1b63c48ea2561d7c))
* optimize physical gamepad for mobile ([1261d8f](https://github.com/tessel-la/robo-boy/commit/1261d8f3872bcc88af5ca828f813456988157069))
* promote stream gateway and physical gamepad updates ([ec66b74](https://github.com/tessel-la/robo-boy/commit/ec66b749fa0fbe3b2c14257f5a40e73c59c2f283))

## [0.6.1-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.6.0-alpha...robo-boy-v0.6.1-alpha) (2026-09-06)


### Bug Fixes

* **android:** ship optimized signed release APK ([4879380](https://github.com/tessel-la/robo-boy/commit/487938024af439334580bc7022cb394e8bba9ae6))
* **android:** ship optimized signed release APK ([639cf4b](https://github.com/tessel-la/robo-boy/commit/639cf4bbb21277be6873a0eef324d96d549e0a4a))
* **android:** ship the signed release APK ([f76922f](https://github.com/tessel-la/robo-boy/commit/f76922f98124e9c8d453ab43511e74575761b63a))
* **ci:** add build-tools to PATH for release signature verification ([db85737](https://github.com/tessel-la/robo-boy/commit/db8573706e1a67de3e7b7e243084ff6d58e836d9))

## [0.6.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.5.0-alpha...robo-boy-v0.6.0-alpha) (2026-09-05)


### Features

* add Android app shell and standby reconnect ([#123](https://github.com/tessel-la/robo-boy/issues/123)) ([c6afcdc](https://github.com/tessel-la/robo-boy/commit/c6afcdc8ec768432693058366bb4a37899feee0f))
* release Android app support ([7bd5fb2](https://github.com/tessel-la/robo-boy/commit/7bd5fb252b31ea704ee95173db18fa7f59a1d139))


### Bug Fixes

* improve desktop app connection and reconnect from the status light instead of restarting the app ([43c632e](https://github.com/tessel-la/robo-boy/commit/43c632ef2567b18c59367cdefc22aac01fb0bd24))

## [0.5.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.4.3-alpha...robo-boy-v0.5.0-alpha) (2026-09-05)


### Features

* iOS build pipeline ([429c90e](https://github.com/tessel-la/robo-boy/commit/429c90e547b4b8e77ab91549d299fd3c1a63c187))

## [0.4.3-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.4.2-alpha...robo-boy-v0.4.3-alpha) (2026-09-04)


### Bug Fixes

* size the app to its own height rather than the screen's ([#116](https://github.com/tessel-la/robo-boy/issues/116)) ([5d8f985](https://github.com/tessel-la/robo-boy/commit/5d8f9851378e1b7a63468389a3834987b343e972))
* size the app to its own height rather than the screen's ([#116](https://github.com/tessel-la/robo-boy/issues/116)) ([1a568bf](https://github.com/tessel-la/robo-boy/commit/1a568bfa4d2e239bcfa417f7e5d29be7b1564394))

## [0.4.2-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.4.1-alpha...robo-boy-v0.4.2-alpha) (2026-09-04)


### Bug Fixes

* check pull request titles on the way into dev as well ([9f5fae3](https://github.com/tessel-la/robo-boy/commit/9f5fae31852be141017542ac1f2645ed4961c48b))
* check pull request titles on the way into dev as well ([#111](https://github.com/tessel-la/robo-boy/issues/111)) ([9f5fae3](https://github.com/tessel-la/robo-boy/commit/9f5fae31852be141017542ac1f2645ed4961c48b))
* Check pull request titles on the way into dev as well ([#111](https://github.com/tessel-la/robo-boy/issues/111)) ([2b7b70b](https://github.com/tessel-la/robo-boy/commit/2b7b70b1f81f39d991d6029e83d648caa544032c))

## [0.4.1-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.4.0-alpha...robo-boy-v0.4.1-alpha) (2026-09-03)


### Bug Fixes

* find the installers where the artifact download actually puts them for build release ([488c970](https://github.com/tessel-la/robo-boy/commit/488c9704a68eef2986e0bb617e899ddd33a80c31))

## [0.4.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.3.1-alpha...robo-boy-v0.4.0-alpha) (2026-09-03)


### Features

* align 3D panel settings UI ([#91](https://github.com/tessel-la/robo-boy/issues/91)) ([eb52d25](https://github.com/tessel-la/robo-boy/commit/eb52d25c1ca6f3d51716d9a41ed25fb8cb3cbe6b))


### Bug Fixes

* make mobile pad menu scrollable ([#88](https://github.com/tessel-la/robo-boy/issues/88)) ([ab6d6a7](https://github.com/tessel-la/robo-boy/commit/ab6d6a7e98f24dbdecb02538effb51f7d1c14f76))

## [0.3.1-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.3.0-alpha...robo-boy-v0.3.1-alpha) (2026-06-30)


### Bug Fixes

* dev main history ([c967c87](https://github.com/tessel-la/robo-boy/commit/c967c874fcf8af68d7d73b706acf758388171304))

## [0.3.0-alpha](https://github.com/tessel-la/robo-boy/compare/robo-boy-v0.2.0-alpha...robo-boy-v0.3.0-alpha) (2026-06-26)


### Features

* add subtree support, DDS configuration, and CI improvements ([#57](https://github.com/tessel-la/robo-boy/issues/57)) ([44b6d4c](https://github.com/tessel-la/robo-boy/commit/44b6d4ccd7e053eef5a487e63302bbe1a99bb509))
