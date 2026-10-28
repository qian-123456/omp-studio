------------------------------ MODULE ProviderKeys ------------------------------
\* Model of: custom provider key storage. ProviderDialog edit form (ProviderDialog.tsx) -> store.upsert ->
\* provider_upsert / provider_encrypt / provider_decrypt / provider_delete (providers/commands.rs) -> ops.rs
\* (models.yml apiKey + vault entry). Synthetic keys only; fault injection models a failing vault file operation.
VARIABLES
  ymlKey,    \* models.yml providers.<id>.apiKey kind: none | plain | ref (vault command reference)
  vault,     \* vault entry for the provider slug exists (vault.rs write_entry/remove_entry)
  dialog,    \* edit dialog: closed | open
  radio,     \* 密钥保存方式 radio (ProviderDialog.tsx keyMode state)
  typed,     \* the key input holds text (ProviderDialog.tsx apiKey state)
  lastSave   \* outcome of last save: none | honoured | ignored | error

vars == <<ymlKey, vault, dialog, radio, typed, lastSave>>

TypeOK ==
  /\ ymlKey \in {"none", "plain", "ref"} /\ vault \in BOOLEAN /\ dialog \in {"closed", "open"}
  /\ radio \in {"plaintext", "encrypted"} /\ typed \in BOOLEAN
  /\ lastSave \in {"none", "honoured", "ignored", "error"}

Init ==
  /\ ymlKey \in {"plain", "ref"}
  /\ vault = (ymlKey = "ref")
  /\ dialog = "closed" /\ radio = "plaintext" /\ typed = FALSE /\ lastSave = "none"

StoredMode == IF ymlKey = "ref" THEN "encrypted" ELSE "plaintext"

OpenEdit ==
  /\ dialog = "closed"
  /\ ymlKey # "none"                                     \* ProviderPanel.tsx:308 edit action exists only on a listed provider row
  /\ dialog' = "open"
  /\ radio' = IF ymlKey = "ref" THEN "encrypted" ELSE "plaintext"   \* ProviderDialog.tsx:75-77
  /\ typed' = FALSE                                      \* ProviderDialog.tsx:74 apiKey starts empty
  /\ UNCHANGED <<ymlKey, vault, lastSave>>

ToggleRadio ==
  /\ dialog = "open"                                     \* KeyModeRadio.tsx:39 only inside the form
  /\ radio' = IF radio = "plaintext" THEN "encrypted" ELSE "plaintext"
  /\ UNCHANGED <<ymlKey, vault, dialog, typed, lastSave>>

TypeKey ==
  /\ dialog = "open"                                     \* ProviderDialog.tsx:695
  /\ ~typed
  /\ typed' = TRUE
  /\ UNCHANGED <<ymlKey, vault, dialog, radio, lastSave>>

CloseEdit ==
  /\ dialog = "open"                                     \* Modal onClose
  /\ dialog' = "closed"
  /\ UNCHANGED <<ymlKey, vault, radio, typed, lastSave>>

\* Save with a typed key: ops::upsert new_key path
SaveWithKey ==
  /\ dialog = "open"                                     \* ProviderDialog.tsx:236 handleSave
  /\ typed                                               \* ProviderDialog.tsx:238 key = apiKey.trim() non-empty -> ops.rs:253-257 new_key
  /\ dialog' = "closed"
  /\ ymlKey' = IF radio = "encrypted" THEN "ref" ELSE "plain"   \* ops.rs:309 key_value, :325-326 set_api_key_text
  /\ vault' = (radio = "encrypted")                      \* ops.rs:294-298 put / :367-369 remove when plaintext
  /\ lastSave' = "honoured"                              \* ProviderDialog.tsx:304 toast "saved"
  /\ UNCHANGED <<radio, typed>>

\* Save with the key input left empty: the radio is sent but ignored by the backend
SaveWithoutKey ==
  /\ dialog = "open"                                     \* ProviderDialog.tsx:236
  /\ ~typed                                              \* ProviderDialog.tsx:301 key || null -> ops.rs:253-257 new_key = None
  /\ dialog' = "closed"
  /\ lastSave' = IF radio = StoredMode THEN "honoured" ELSE "ignored"   \* ops.rs:294-307 no key branch touches vault/apiKey; ProviderDialog.tsx:304 still toasts saved
  /\ UNCHANGED <<ymlKey, vault, radio, typed>>

\* Plaintext save whose vault cleanup fails: models.yml is already written (ops.rs:185-189, 199-201)
SavePlainVaultCleanupFails ==
  /\ dialog = "open"                                     \* ProviderDialog.tsx:236
  /\ typed                                               \* ops.rs:253-257
  /\ radio = "plaintext"                                 \* ops.rs:367 only plaintext removes the vault entry
  /\ vault                                               \* ops.rs:367-369 remove has something to fail on
  /\ dialog' = "closed"
  /\ ymlKey' = "plain"                                   \* ops.rs:312-350 edit_file succeeded
  /\ lastSave' = "error"                                 \* ops.rs:368 `?` returns Err after the file edit
  /\ UNCHANGED <<vault, radio, typed>>

RowEncrypt ==
  /\ ymlKey = "plain"                                    \* ops.rs:210 kind must be Plaintext
  /\ ymlKey' = "ref"                                     \* ops.rs:214 apply_key Encrypted
  /\ vault' = TRUE                                       \* ops.rs:182 put
  /\ UNCHANGED <<dialog, radio, typed, lastSave>>

RowDecrypt ==
  /\ ymlKey = "ref"                                      \* ops.rs:222-223 kind Encrypted
  /\ vault                                               \* ops.rs:229-232 vault must hold the key
  /\ ymlKey' = "plain"                                   \* ops.rs:233 apply_key Plaintext writes models.yml
  /\ vault' = FALSE                                      \* ops.rs:199-201 then removes the vault entry
  /\ UNCHANGED <<dialog, radio, typed, lastSave>>

RowDecryptVaultCleanupFails ==
  /\ ymlKey = "ref"                                      \* ops.rs:222-223
  /\ vault                                               \* ops.rs:229-232
  /\ ymlKey' = "plain"                                   \* ops.rs:185-189 file edited first
  /\ UNCHANGED <<vault, dialog, radio, typed, lastSave>> \* ops.rs:200 `?` fails, vault entry stays

DeleteProvider ==
  /\ ymlKey # "none"                                     \* ops.rs:466 block must exist
  /\ dialog = "closed"                                   \* ProviderDialog.tsx:225-233 delete closes the dialog
  /\ ymlKey' = "none"                                    \* ops.rs:469 block removed
  /\ vault' = FALSE                                      \* ops.rs:476 vault entry removed
  /\ UNCHANGED <<dialog, radio, typed, lastSave>>

DeleteVaultCleanupFails ==
  /\ ymlKey # "none"                                     \* ops.rs:466
  /\ vault                                               \* ops.rs:476 vault entry present to fail on
  /\ dialog = "closed"                                   \* ProviderDialog.tsx:225-233
  /\ ymlKey' = "none"                                    \* ops.rs:469-475 block already removed
  /\ UNCHANGED <<vault, dialog, radio, typed, lastSave>> \* ops.rs:476 remove fails, entry stays

Next == OpenEdit \/ ToggleRadio \/ TypeKey \/ CloseEdit \/ SaveWithKey \/ SaveWithoutKey
        \/ SavePlainVaultCleanupFails \/ RowEncrypt \/ RowDecrypt \/ RowDecryptVaultCleanupFails \/ DeleteProvider \/ DeleteVaultCleanupFails

Spec == Init /\ [][Next]_vars

\* 保存后，密钥的存放方式必须和用户在表单里选的方式一致。
SavedModeMatchesChoice == lastSave # "ignored"

\* 加密库里存在某个供应商的密钥时，配置文件里一定还有指向它的引用。
NoOrphanVaultKey == vault => ymlKey = "ref"
=================================================================================
