------------------------- MODULE ClipboardNameCollision -------------------------
\* 粘贴/拖入文件缓存（save_clipboard_file → save_clipboard_file_internal）: 目标文件名只由毫秒时间戳与文件名组成。
\* 模型描述现有代码（from-spec）；代码根目录 omp-workspace/.worktrees/bug-fix (HEAD 7f85613)。
\* 范围: 两次保存；sameKey 表示两次保存落在同一毫秒且文件名相同（由外部世界决定）；图片变体 save_clipboard_image 带存在性循环，按只读处理。
EXTENDS Naturals

VARIABLES
  sameKey,  \* 两次保存是否算出了同一个 "{毫秒}-{文件名}" (clipboard.rs:228-229)
  s1,       \* 第一次保存: idle/done
  s2,       \* 第二次保存: idle/done
  disk      \* 缓存目录中各路径的内容: p1/p2/shared 路径 -> none/c1/c2

vars == <<sameKey, s1, s2, disk>>

Paths == {"p1", "p2", "shared"}

TypeOK ==
  /\ sameKey \in BOOLEAN
  /\ s1 \in {"idle", "done"}
  /\ s2 \in {"idle", "done"}
  /\ disk \in [Paths -> {"none", "c1", "c2"}]

Init ==
  /\ sameKey \in BOOLEAN
  /\ s1 = "idle"
  /\ s2 = "idle"
  /\ disk = [p \in Paths |-> "none"]

Path1 == IF sameKey THEN "shared" ELSE "p1"
Path2 == IF sameKey THEN "shared" ELSE "p2"

Save1 ==
  /\ s1 = "idle"                         \* Composer.tsx:1779 每个粘贴的文件各调用一次 saveClipboardFile
  /\ s1' = "done"                        \* clipboard.rs:230 std::fs::write 返回即成功
  /\ disk' = [disk EXCEPT ![Path1] = "c1"]   \* clipboard.rs:229-230 路径无存在性检查，直接写入
  /\ UNCHANGED <<sameKey, s2>>

Save2 ==
  /\ s2 = "idle"                         \* Composer.tsx:1779
  /\ s2' = "done"                        \* clipboard.rs:230
  /\ disk' = [disk EXCEPT ![Path2] = "c2"]   \* clipboard.rs:229-230
  /\ UNCHANGED <<sameKey, s1>>

Next == Save1 \/ Save2
Spec == Init /\ [][Next]_vars

Done == s1 = "done" /\ s2 = "done"

\* 两个附件保存完成后，各自返回的路径里应当是各自的内容。
EachAttachmentKeepsItsBytes == Done => (disk[Path1] = "c1" /\ disk[Path2] = "c2") \* services/clipboard.rs:228-231
=============================================================================
