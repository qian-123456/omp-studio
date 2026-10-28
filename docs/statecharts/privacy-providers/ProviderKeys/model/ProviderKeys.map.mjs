// 供应商密钥存放: 标签为简体中文，面向产品评审者。
export const readerActions = ["OpenEdit", "ToggleRadio", "TypeKey", "CloseEdit", "SaveWithKey", "SaveWithoutKey", "SavePlainVaultCleanupFails", "RowEncrypt", "RowDecrypt", "RowDecryptVaultCleanupFails", "DeleteProvider", "DeleteVaultCleanupFails"];

export function state(v) {
  const cfg = { none: "配置里没有密钥", plain: "配置里是明文密钥", ref: "配置里是加密引用" }[v.ymlKey];
  const vault = v.vault ? "加密库里有密钥" : "加密库里没有密钥";
  const form = v.dialog === "open"
    ? `，编辑表单打开，选的是${v.radio === "encrypted" ? "加密保存" : "明文写入"}，${v.typed ? "已输入新密钥" : "没有输入新密钥"}`
    : "";
  const res = { none: "", honoured: "，上次保存按所选方式生效", ignored: "，上次保存提示成功但所选方式没有生效", error: "，上次操作报错但配置已改" }[v.lastSave];
  return `${cfg}，${vault}${form}${res}`;
}
const STEPS = {
  OpenEdit: "打开供应商编辑表单",
  ToggleRadio: "切换密钥保存方式",
  TypeKey: "输入新密钥",
  CloseEdit: "关闭表单不保存",
  SaveWithKey: "输入新密钥后保存",
  SaveWithoutKey: "不输入新密钥直接保存",
  SavePlainVaultCleanupFails: "改成明文保存时清理加密库失败",
  RowEncrypt: "在列表里点加密",
  RowDecrypt: "在列表里点改回明文",
  RowDecryptVaultCleanupFails: "改回明文时清理加密库失败",
  DeleteProvider: "删除供应商",
  DeleteVaultCleanupFails: "删除供应商时清理加密库失败",
};
export function step(action) { return STEPS[action] ?? action; }
export function cause(v, facts, invariant) {
  if (invariant === "SavedModeMatchesChoice") return "没有输入新密钥时，所选保存方式被忽略，已有密钥的存放方式没变，界面仍提示保存成功";
  return "配置文件先改完，再清理加密库，清理失败后加密库里留下没有任何引用的密钥";
}
export function group(v) {
  if (v.lastSave === "ignored") return "所选方式被忽略";
  if (v.vault && v.ymlKey !== "ref") return "加密库留有孤立密钥";
  return "正常";
}
export const groupColors = { "所选方式被忽略": "#fde2e2", "加密库留有孤立密钥": "#ffe9c7", "正常": "#e2f5e9" };
