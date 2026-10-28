---------------------- MODULE FileEditorBuffer ----------------------
\* 设置页共用单文件编辑器（规则文件、记忆文件、子代理文件）的缓冲区生命周期。
\* 抽象：文本内容用整数编号；编号 0 在 userWants 中表示"跟随磁盘"。
EXTENDS Naturals

VARIABLES
  disk,        \* FileEditor.tsx 所读写的磁盘文件内容编号（omp_files.rs write_checked 的 stamp_of）
  stamp,       \* FileEditor.tsx:75 stamp
  loaded,      \* FileEditor.tsx:74 loaded
  draft,       \* FileEditor.tsx:76 draft（CodeMirror value）
  saving,      \* FileEditor.tsx:79 saving
  saveText,    \* FileEditor.tsx:142 const text = draft
  conflict,    \* FileEditor.tsx:157 conflict 确认框打开
  reloading,   \* FileEditor.tsx:78 loading
  userWants,   \* 用户最后一次主动输入的内容编号；0 表示用户没有未提交的输入意图
  nextId       \* 抽象：下一个新内容编号

vars == <<disk, stamp, loaded, draft, saving, saveText, conflict, reloading, userWants, nextId>>
MaxId == 4

Dirty == draft # loaded   \* FileEditor.tsx:84 dirty = draft !== loaded

Init == /\ disk = 1 /\ stamp = 1 /\ loaded = 1 /\ draft = 1
        /\ saving = FALSE /\ saveText = 0 /\ conflict = FALSE /\ reloading = FALSE
        /\ userWants = 0 /\ nextId = 2

\* 用户在编辑器里输入：CodeMirror editable={!readOnly}，保存中也可输入 (FileEditor.tsx:346)
TypeText ==
  /\ nextId <= MaxId
  /\ ~conflict                       \* 冲突确认框是模态框 (FileEditor.tsx:157 confirmDialog)
  /\ draft' = nextId /\ userWants' = nextId /\ nextId' = nextId + 1
  /\ UNCHANGED <<disk, stamp, loaded, saving, saveText, conflict, reloading>>

\* 点保存或按 ⌘S (FileEditor.tsx:140 `if (!dirty || saving) return`)
SaveStart ==
  /\ Dirty /\ ~saving /\ ~conflict   \* FileEditor.tsx:140
  /\ saving' = TRUE /\ saveText' = draft   \* FileEditor.tsx:141-142
  /\ UNCHANGED <<disk, stamp, loaded, draft, conflict, reloading, userWants, nextId>>

\* 磁盘与 stamp 相符，保存成功 (omp_files.rs:83 write_checked；FileEditor.tsx:147-153)
SaveSucceeds ==
  /\ saving
  /\ ~conflict                       \* FileEditor.tsx:157 冲突确认框打开时保存循环停在 await confirmDialog
  /\ stamp = disk                    \* omp_files.rs:83 stamp 相符才写
  /\ disk' = saveText /\ stamp' = saveText
  /\ loaded' = saveText              \* FileEditor.tsx:148
  /\ draft' = saveText               \* FileEditor.tsx:150 setDraft(text)
  /\ saving' = FALSE
  /\ UNCHANGED <<saveText, conflict, reloading, userWants, nextId>>

\* stamp 不符，写入被拒 (omp_files.rs:83-85；FileEditor.tsx:156-160)
SaveConflicts ==
  /\ saving                          \* FileEditor.tsx:143 只有保存进行中才会收到 saveFile 的拒绝
  /\ ~conflict                       \* FileEditor.tsx:157 同一时刻只有一个确认框
  /\ stamp # disk                    \* omp_files.rs:83
  /\ conflict' = TRUE                \* FileEditor.tsx:157
  /\ UNCHANGED <<disk, stamp, loaded, draft, saving, saveText, reloading, userWants, nextId>>

\* 冲突框选"覆盖"：采用当前磁盘 stamp 再试 (FileEditor.tsx:168)
ConflictOverwrite ==
  /\ conflict
  /\ stamp' = disk /\ conflict' = FALSE
  /\ UNCHANGED <<disk, loaded, draft, saving, saveText, reloading, userWants, nextId>>

\* 冲突框选"重新读取"：用磁盘内容替换缓冲区 (FileEditor.tsx:161-165)
ConflictReload ==
  /\ conflict
  /\ loaded' = disk /\ stamp' = disk /\ draft' = disk   \* FileEditor.tsx:97-99 apply
  /\ saving' = FALSE /\ conflict' = FALSE /\ userWants' = 0
  /\ UNCHANGED <<disk, saveText, reloading, nextId>>

\* omp 或其他程序改了磁盘文件
ExternalWrite ==
  /\ nextId <= MaxId
  /\ disk' = nextId /\ nextId' = nextId + 1
  /\ UNCHANGED <<stamp, loaded, draft, saving, saveText, conflict, reloading, userWants>>

\* 点"重新读取"：未改动直接读；有改动先确认丢弃 (FileEditor.tsx:211-221)；按钮仅在读取中禁用 (FileEditor.tsx:274)
ReloadStart ==
  /\ ~reloading                      \* FileEditor.tsx:274 读取中按钮 disabled={loading}
  /\ ~conflict                       \* FileEditor.tsx:157 模态确认框遮挡按钮
  /\ reloading' = TRUE
  /\ userWants' = 0                  \* 点击时的内容已被用户确认丢弃或本就没有改动
  /\ UNCHANGED <<disk, stamp, loaded, draft, saving, saveText, conflict, nextId>>

\* 读取返回并应用 (FileEditor.tsx:107-118, 96-101)
ReloadDone ==
  /\ reloading
  /\ loaded' = disk /\ stamp' = disk /\ draft' = disk    \* FileEditor.tsx:97-99
  /\ reloading' = FALSE
  /\ UNCHANGED <<disk, saving, saveText, conflict, userWants, nextId>>

\* 点"放弃修改" (FileEditor.tsx:198-209；按钮保存中禁用 FileEditor.tsx:323)
Discard ==
  /\ Dirty                           \* FileEditor.tsx:199 if (!dirty) return
  /\ ~saving                         \* FileEditor.tsx:323 disabled={!dirty || saving}
  /\ ~conflict                       \* FileEditor.tsx:157 模态确认框遮挡按钮
  /\ draft' = loaded /\ userWants' = 0
  /\ UNCHANGED <<disk, stamp, loaded, saving, saveText, conflict, reloading, nextId>>

Next == TypeText \/ SaveStart \/ SaveSucceeds \/ SaveConflicts \/ ConflictOverwrite
        \/ ConflictReload \/ ExternalWrite \/ ReloadStart \/ ReloadDone \/ Discard

Spec == Init /\ [][Next]_vars

\* 规则：用户输入过的文字，在保存和重新读取都结束后仍留在编辑器里。
TypedTextKept ==
  (~saving /\ ~conflict /\ ~reloading /\ userWants # 0) => draft = userWants

=====================================================================
