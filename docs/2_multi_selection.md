# 2. 複数選択機能

## 概要
Shiftキーを押しながらのクリックやドラッグによる範囲選択で、複数のダンサーを同時に選択・移動・操作できるようにします。

## 実装詳細

### 1. 状態管理の変更 (`App.tsx`)

```typescript
// 現在
const [selectedDancerId, setSelectedDancerId] = useState<string | null>(null);

// 変更案
const [selectedDancerIds, setSelectedDancerIds] = useState<Set<string>>(new Set());
// 互換性のため、単一選択のgetter/setterもヘルパーとして残すか、UI側を全面的に書き換える
```

### 2. インタラクションの拡張 (`Stage.tsx`)
- `handlePointerDown`:
    - Shiftキーが押されている場合: クリックされたダンサーを `selectedDancerIds` に追加/削除（トグル）。
    - Shiftキーなしの場合: 既存の選択をクリアして新規選択。
    - 何もないところをクリック: 全選択解除。
- ドラッグ操作:
    - 選択中のダンサーのいずれかをドラッグした場合、**選択されている全てのダンサー**に同じ移動量（デルタ）を適用します。

### 3. 範囲選択（矩形選択）
- 背景をドラッグした際に「選択矩形（Selection Box）」を描画します。
- ポインターアップ時に、矩形に含まれるダンサーをまとめて選択状態にします。

### 4. プロパティ一括変更
- サイドバーのUI (`App.tsx`) で、色変更や削除ボタンが「選択中の全ダンサー」に対して作用するように改修します。

## 難易度
中（状態管理の変更に伴い、影響範囲がアプリ全体に及ぶ）
