# タスク回復ガイド

## 概要

タイムアウトや中断後に、続きから作業を再開するための仕組み。

## ファイル構成

```
task_progress.json - 現在のタスク進捗状態を管理するJSONファイル
README_TASK_RECOVERY.md - このドキュメント
```

## 進捗ファイルの構造

```json
{
  "task_id": "タスク識別子",
  "description": "タスクの説明",
  "status": "in_progress|completed|blocked",
  "last_updated": "ISO8601形式のタイムスタンプ",
  "steps": {
    "ステップID": {
      "status": "pending|in_progress|completed",
      "description": "ステップの説明",
      "completed": true/false,
      "notes": "任意のメモ"
    }
  },
  "current_step": "現在のステップID",
  "next_action": "次にすべきことの説明",
  "context": {
    "作業コンテキスト情報"
  },
  "recovery_notes": [
    "復旧時の注意点"
  ]
}
```

## ワークフロー

### 1. タスク開始時

```bash
# 既存の進捗ファイルを確認
cat task_progress.json

# working memory も検索
search_working_memory(query: "task_progress")
```

### 2. 進捗更新時

各ステップ完了時、`task_progress.json` を更新：

- `steps.<step_id>.status` を `"completed"` に
- `current_step` を次のステップに
- `last_updated` を現在時刻に

### 3. タスク完了時

- `status` を `"completed"` に
- 進捗ファイルをアーカイブするか削除

### 4. 中断後の再開時

```bash
# 1. 進捗ファイルを読む
cat task_progress.json

# 2. working memory を確認
search_working_memory(query: "task_progress または task_id")

# 3. current_step から再開

# 4. 重要な発見は create_issue でトラック
```

## 実践例

### 長時間の実装作業

```json
{
  "task_id": "implement_group_selection",
  "status": "in_progress",
  "steps": {
    "1_types": { "status": "completed", "description": "型定義の追加" },
    "2_state": { "status": "completed", "description": "状態管理の追加" },
    "3_component": { "status": "in_progress", "description": "GroupListコンポーネントの実装" },
    "4_tests": { "status": "pending", "description": "テストの作成" }
  },
  "current_step": "3_component",
  "next_action": "GroupList.tsxの実装を続ける。useHistoryフックと統合する。"
}
```

### 複数の調査タスク

```json
{
  "task_id": "investigate_performance_issue",
  "status": "in_progress",
  "steps": {
    "1_reproduce": { "status": "completed", "description": "問題の再現" },
    "2_profiling": { "status": "in_progress", "description": "プロファイリング" },
    "3_analyze": { "status": "pending", "description": "データ分析" },
    "4_fix": { "status": "pending", "description": "修正" }
  },
  "current_step": "2_profiling",
  "context": {
    "issue": "ステージ上の100以上のダンサーで描画が遅延",
    "bottleneck_suspected": "レンダリング",
    "files_to_check": ["src/components/Stage.tsx", "src/types.ts"]
  }
}
```

## working memory との連携

進捗情報を working memory にも保存することで、検索可能に：

```
タイプ: task_progress
内容: タスクID、現在のステップ、重要な発見
```

検索例：
```
search_working_memory(query: "task_progress")
search_working_memory(query: "implement_group_selection")
search_working_memory(query: "bottleneck_suspected")
```

## create_issue との使い分け

| 進捗ファイル | working memory | create_issue |
|-------------|----------------|--------------|
| 現在のタスクの即時状態 | 永続的な事実/決定 | スコープ外の発見 |

## ベストプラクティス

1. **小さなステップに分解**: 1ステップが長すぎると再開が難しい
2. **定期的な更新**: 5-10分ごと、または大きな成果物の作成時
3. **具体的な記述**: "コードを書く" ではなく "GroupList.tsxの42行目まで実装"
4. **コンテキスト保存": どのファイル、どの関数を見ているか
5. **メモ活用": なぜそうしたか、何を試したかを記録

## テンプレート

新しいタスク開始時にコピーして使うテンプレート：

```json
{
  "task_id": "",
  "description": "",
  "status": "in_progress",
  "last_updated": "",
  "steps": {
    "1_": {
      "status": "pending",
      "description": "",
      "completed": false,
      "notes": ""
    }
  },
  "current_step": "1_",
  "next_action": "",
  "context": {},
  "recovery_notes": []
}
```
