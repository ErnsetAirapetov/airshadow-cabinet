Фордж: GitLab (glab CLI)

| действие | команда |
|---|---|
| список меток | glab label list |
| создать метку | glab label create -n "<имя>" -c <hex> -d "<описание>" |
| список задач | glab issue list --output json |
| прочитать задачу | glab issue view <N> |
| создать задачу | glab issue create -t "<t>" -d "$(cat <f>)" -l <l> -y |
| комментарий к задаче | glab issue note <N> -m "<текст>" |
| пометить решением | glab issue update <N> --label needs-decision |
| закрыть задачу | glab issue note <N> -m "<итог>" && glab issue close <N> |
| создать милстоун | glab api projects/:id/milestones -f title="<t>" |
| создать задачу с милстоуном | glab issue create -t "<t>" -d "$(cat <f>)" -l <l> -m "<t>" -y |
| закрыть милстоун | glab api projects/:id/milestones/<id, НЕ iid> -X PUT -f state_event=close |
| список MR | glab mr list --output json |
| прочитать MR / дифф | glab mr view <N> / glab mr diff <N> |
| создать MR | glab mr create -b airshadow-dev -t "<t>" -d "$(cat <f>)" -y (в описании: Closes #N) |
| добавить метку к MR | glab mr update <N> --label <l> |
| комментарий к MR | glab mr note <N> -m "<текст>" |
| смержить MR | glab mr merge <N> --squash --remove-source-branch -y |

Нюансы:
- без -t/-d/-y glab открывает интерактивный редактор — агенту он недоступен,
  поэтому флаги в командах обязательны;
- `-d "$(cat <f>)"` — POSIX-изм, в PowerShell не работает. Там:
  `-d (Get-Content -Raw -Encoding UTF8 <f>)` — именно с `-Encoding UTF8`:
  без него PowerShell 5.1 читает UTF-8-файл без BOM в системной ANSI, и
  русский текст манглится молча, команда отрабатывает без ошибки;
- `<id, НЕ iid>` в «закрыть милстоун» не опечатка: glab api ждёт глобальный id
  милестоуна, а не порядковый номер внутри проекта;
- glab mr merge при работающем пайплайне ставит auto-merge (мерж после
  зелёного пайплайна) — обычно это и нужно; мержить немедленно:
  добавь --auto-merge=false;
- Closes #N в описании MR закрывает задачу при мерже;
- self-hosted: перед первой работой `glab auth login --hostname <хост>`;
- `--remove-source-branch` падает, если ветку ещё держит worktree, хотя MR к
  этому моменту уже `merged` — код возврата в этом случае лжёт про провал.
  Ритуал `/land` поэтому снимает worktree до мержа; признак успеха —
  состояние MR на фордже, не код возврата команды.

Этот репозиторий (форк):
- три ветки, и путь кода между ними односторонний:
  `<ветка задачи>` → MR → **`airshadow-dev`** (дев-стенд) → промоушен-MR →
  **`airshadow-prod`** (реальный прод). `main` — зеркало апстрима
  BEDOLAGA-DEV, MR туда не открываем вообще;
- целевая ветка MR обычной задачи — **`airshadow-dev`**. На фордже
  default_branch = `main`, поэтому `-b airshadow-dev` в `glab mr create`
  обязателен: без флага MR уедет в зеркало апстрима;
- промоушен на прод — отдельный MR `airshadow-dev` → `airshadow-prod`
  (`glab mr create -b airshadow-prod -s airshadow-dev ...`), заводится
  осознанно и только с ведома владельца: с мержем этот код уезжает на живой
  прод. Прямой пуш в `airshadow-prod` запрещён и гейтом, и защитой на фордже;
- на GitLab пайплайна нет (`.gitlab-ci.yml` отсутствует, `.github/workflows/*`
  — мёртвые GitHub Actions), поэтому `glab mr merge` мержит сразу, auto-merge
  не включается, а зелёного CI на MR ждать неоткуда: проверки гоняем локально
  (`npm test`, `npm run build`);
- `glab` живёт в `C:\CLI\glab\glab.exe` — в PATH его может не быть, зови по
  полному пути;
- id проекта на фордже — 83504465 (`airshadow/cabinet`), для `glab api` можно
  писать `projects/:id` из чек-аута или `projects/airshadow%2Fcabinet`.

Windows:
- команды форджа и ритуалы запускать из PowerShell;
- перед первой командой форджа в сессии:
  `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.
  Без этого UTF-8 вывод gh/glab приходит кракозябрами на кодовой странице
  cp1251/cp866, и русские титулы задач нечитаемы;
- длинный русский текст (тело задачи, тело PR) подавать файлом:
  `--body-file <f>` у gh, `-d (Get-Content -Raw -Encoding UTF8 <f>)` у glab
  (без `-Encoding UTF8` файл без BOM прочитается в ANSI и текст манглится
  молча). В аргументе командной строки он тоже манглится;
- если всё же работаете из Git Bash: аргумент, начинающийся со слэша,
  MSYS превратит в путь (`/land` → `C:/Program Files/Git/land`) ещё до
  запуска программы. Обход — `MSYS_NO_PATHCONV=1` или двойной слэш `//land`.
