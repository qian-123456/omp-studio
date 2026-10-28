## 1. 配置里是明文密钥，加密库里有密钥

Rule broken: 加密库里存在某个供应商的密钥时，配置文件里一定还有指向它的引用。
Why: 配置文件先改完，再清理加密库，清理失败后加密库里留下没有任何引用的密钥.
In the model, 3 different steps lead into this bug: "改回明文时清理加密库失败", "删除供应商时清理加密库失败", and "改成明文保存时清理加密库失败". The steps below are the shortest path that TLC found.

0. Start: 配置里是加密引用，加密库里有密钥
1. 改回明文时清理加密库失败. Now: 配置里是明文密钥，加密库里有密钥

With the fix you see the same states and steps, so the fix does not change this path.

## 2. 配置里是明文密钥，加密库里没有密钥，上次保存提示成功但所选方式没有生效

Rule broken: 保存后，密钥的存放方式必须和用户在表单里选的方式一致。
Why: 没有输入新密钥时，所选保存方式被忽略，已有密钥的存放方式没变，界面仍提示保存成功.
In the model, one step leads into this bug: "不输入新密钥直接保存". The steps below are the shortest path that TLC found.

0. Start: 配置里是明文密钥，加密库里没有密钥
1. 打开供应商编辑表单. Now: 配置里是明文密钥，加密库里没有密钥，编辑表单打开，选的是明文写入，没有输入新密钥
2. 切换密钥保存方式. Now: 配置里是明文密钥，加密库里没有密钥，编辑表单打开，选的是加密保存，没有输入新密钥
3. 不输入新密钥直接保存. Now: 配置里是明文密钥，加密库里没有密钥，上次保存提示成功但所选方式没有生效

With the fix, step 3 (不输入新密钥直接保存) takes you to: 配置里是加密引用，加密库里有密钥，上次保存按所选方式生效.
