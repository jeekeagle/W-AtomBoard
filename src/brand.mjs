/**
 * W-AtomBoard 品牌与运行时常量。
 *
 * 写作版与 W-AtomBoard 共享同一套引擎，但必须使用独立的数据、配置与端口，
 * 这样两个看板可以在同一台机器上同时运行，互不污染。
 */
export const BRAND = {
  name: 'W-AtomBoard',
  nameCn: '写作原子看板',
  tagline: '一个 Atom 是一个选题或章节：交给 Codex 写，稿件落盘，进度回流。',
  cli: 'watomboard',
  dbFile: 'watomboard.db',
  globalDir: '.watomboard',
  localStoragePrefix: 'watomboard',
  defaultPort: 7789,
  /** 写作版每个项目在得到大脑里对应 WATOM-<项目名> 知识库 */
  kbPrefix: 'WATOM-',
};
