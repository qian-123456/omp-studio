## 1. 空闲: 没有未保存修改，用户后敲的字已消失

Rule broken: 规则：用户输入过的文字，在保存和重新读取都结束后仍留在编辑器里。
In the model, 2 different steps lead into this bug: "读取结果返回" and "保存成功返回". The steps below are the shortest path that TLC found.

0. Start: 空闲: 没有未保存修改
1. 点重新读取. Now: 正在重新读取: 没有未保存修改
2. 继续输入文字. Now: 正在重新读取: 有未保存修改
3. 读取结果返回. Now: 空闲: 没有未保存修改，用户后敲的字已消失
