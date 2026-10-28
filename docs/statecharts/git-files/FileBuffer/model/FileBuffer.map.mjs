// 右侧面板文本文件缓冲区的图例文字（简体中文，读者视角）。
export const readerActions = ["OpenTab", "UserEdit", "UserRevert", "SaveStart", "DismissExternal", "ReloadPanel", "SwitchAway", "SwitchBack", "CloseTab", "FocusReadStart"];

export function state(v, facts) {
  const lost = [];
  if (v.lostSwitch) lost.push("切换标签时丢了草稿");
  if (v.lostClose) lost.push("关闭标签时丢了草稿");
  if (v.lostReload) lost.push("点重新载入丢了草稿");
  if (v.lostRefresh) lost.push("聚焦刷新冲掉了输入");
  if (v.clobber) lost.push("覆盖了没见过的磁盘改动");
  const tail = lost.length ? "，" + lost.join("、") : "";
  if (!v.tabOpen) return "文件标签未打开" + tail;
  if (!v.shown) return "标签已打开但当前在看别的标签" + tail;
  if (v.saved === "none") return "正在读取文件" + tail;
  const dirty = v.draft !== v.saved;
  const banner = v.external ? "，提示磁盘已变" : "";
  if (v.saving) return "正在保存" + banner + tail;
  return (dirty ? "有未保存改动" : "无未保存改动") + banner + tail;
}

const STEPS = {
  CloseTab: "关闭标签",
  DismissExternal: "点保留我的修改",
  ExternalWrite: "代理在后台改了磁盘文件",
  FocusReadFinish: "聚焦后台重读返回",
  FocusReadStart: "窗口重新获得焦点",
  LoadDone: "文件读取完成",
  OpenTab: "点击路径打开文件",
  ReloadPanel: "点重新载入",
  SaveFinish: "写盘完成",
  SaveStart: "点保存",
  SwitchAway: "切换到别的标签",
  SwitchBack: "切回这个标签",
  UserEdit: "输入文字",
  UserRevert: "把文字改回原样",
};
export function step(action, before, after) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  return ({"NoLossOnClose": "关闭时没有检查未保存内容", "NoLossOnReload": "重新读取直接覆盖草稿", "NoLossOnSwitch": "切换标签后编辑缓冲区被重建", "NoClobber": "保存没有核验磁盘版本", "NoLossOnRefresh": "后台读取采用过期的未修改状态"})[invariant] ?? "生命周期边界";
}
