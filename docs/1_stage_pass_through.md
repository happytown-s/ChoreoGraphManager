# 1. 舞台袖（上下左右）の通過UI

## 概要
現在の「左右の袖（Wings）」に加え、舞台の手前（下）と奥（上）にも袖エリアを可視化し、ダンサーが舞台裏を通って反対側へ移動するような動線を記録・視認しやすくします。

## 実装詳細

### 1. 定数の拡張
`src/components/Stage.tsx` および `src/types.ts` (もしあれば)

```typescript
// 現在
const WINGS_WIDTH = 125;

// 変更案
const WING_SIZE = 150; // 上下左右共通のサイズ、または個別に設定
const WING_TOP = 100;
const WING_BOTTOM = 100;
```

### 2. 描画ロジックの変更 (`drawScene`)
- 現在の `fillRect` で左右の袖を描画している箇所を拡張し、上下の袖も描画します。
- 舞台裏（Backstage）としての表現（少し暗い色にする、斜線を入れるなど）を検討します。
- グリッド線の描画範囲を拡張します。

### 3. ドラッグ移動制限の緩和
- `handlePointerMove` 内のクランプ処理（`Math.max/min`）を緩和し、上下方向も舞台外へドラッグ可能にします。

```typescript
// 現在
x = Math.max(-WINGS_WIDTH + 20, Math.min(STAGE_WIDTH + WINGS_WIDTH - 20, x));
y = Math.max(20, Math.min(STAGE_HEIGHT - 20, y));

// 変更案
y = Math.max(-WING_TOP + 20, Math.min(STAGE_HEIGHT + WING_BOTTOM - 20, y));
```

### 4. ズーム・フィットの調整
- `fitStageToCanvas` 関数で、上下の袖も含めた全体のサイズが収まるように計算式を調整します。

## 難易度
低（既存ロジックのパラメータ調整と描画範囲拡張が主）
