# 3. 曲線移動（ベジェ曲線）

## 概要
直線的な移動だけでなく、制御点（Control Point）を用いた滑らかな曲線移動を実現します。
単純な2次ベジェ曲線（始点、終点、制御点1つ）を採用し、UI上で直感的にカーブを調整できるようにします。

## 実装詳細

### 1. データ構造の拡張 (`types.ts`)

```typescript
interface Position {
  x: number;
  y: number;
}

// キーフレーム間の補間情報を保持する必要があるため、構造を見直す
// キーフレーム自体に「次のキーフレームへの補間設定」を持たせるか、
// 専用のパスデータを定義する
interface Keyframe {
  id: string;
  timestamp: number;
  positions: Record<string, Position>;
  
  // 追加: 各ダンサーの、このキーフレームから次のキーフレームへの移動制御点
  controlPoints?: Record<string, Position>; 
}
```

### 2. 補間ロジックの変更 (`App.tsx` -> `getCurrentPositions`)
- 線形補間（Linear Interpolation）から、2次ベジェ曲線（Quadratic Bezier）への変更。
- `controlPoints` が存在する場合はベジェ計算、なければ従来通り線形補間。

```typescript
// 2次ベジェ: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
```

### 3. UI実装 (`Stage.tsx`)
- 選択中のダンサーについて、現在のキーフレームと次のキーフレームの間を結ぶ「パス」を表示します。
- 線上に「制御点ハンドル（四角いコントロールポイント）」を表示します。
- ユーザーがハンドルをドラッグすることで、`controlPoints` データを更新します。
- デフォルトでは制御点は始点と終点の中点（＝直線）に配置します。

## 難易度
中〜高（数学的な計算と、新たなUI要素「制御点ハンドル」の管理が必要）
