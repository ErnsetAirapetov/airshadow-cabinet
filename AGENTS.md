# AGENTS.md

Короткая карта для агентов. Продуктовые и процессные правила форка — в
[CLAUDE.md](CLAUDE.md), он главный; здесь только то, что нужно, чтобы начать
работать и ничего не сломать.

## Что это

Форк AirShadow апстрим-проекта [BEDOLAGA-DEV/bedolaga-cabinet](https://github.com/BEDOLAGA-DEV/bedolaga-cabinet)
— веб-кабинет VPN-сервиса: пользовательская часть (`src/pages/Dashboard.tsx`,
`Subscription*`, `Balance*`, `Connection*`) и админ-панель (~70 страниц
`src/pages/Admin*`). Статику собирает control-plane: из `airshadow-dev` — на
дев-стенд, из `airshadow-prod` — на реальный прод.

## Стек и проверки

React 19 + TypeScript + Vite 7, Tailwind, Radix, TanStack Query, zustand,
i18next; тесты — vitest, форматирование — Biome.

```bash
npm test         # vitest run — 18 файлов, 119 тестов
npm run build    # tsc && vite build — главная проверка
```

Dev-окружение для валидации непригодно (см. CLAUDE.md) — доказательство
работоспособности здесь это зелёная сборка и тесты, а не «посмотрел глазами».
`npm run check` (Biome) на унаследованном апстрим-коде **красный** (22 ошибки) —
в гейты он не заведён намеренно; на своих файлах ориентироваться на него можно,
чинить чужие — нет.

## Правила работы

- Ветка → MR в **`airshadow-dev`** (дев-стенд). Прямые коммиты и пуши в
  `airshadow-dev`, `airshadow-prod` и `main` запрещены (`main` — зеркало
  апстрима, руками не трогаем).
- На прод код уезжает отдельным промоушен-MR `airshadow-dev` →
  `airshadow-prod` — только по решению владельца, мерж означает выкатку.
- Любая правка апстримного файла — будущий конфликт при синке. Правка должна
  быть узкой; переформатирование апстримного кода «по дороге» не делаем.
- `src/pages/Login.tsx` — особый случай: резолвить вручную, наша раскладка +
  логика апстрима. Порядок — в CLAUDE.md, читать до того, как трогать файл.
- Хостинг — GitLab, CLI `glab` (`C:\CLI\glab\glab.exe`), PR называются MR.
  Команды форджа — `.claude/forge.md`.

## Харнес

Привязки процесса лежат в `.claude/`: `harness.json` (ветки, проверки, модели),
`forge.md` (команды GitLab), `orchestrator.md` (персона оркестратора).
Шаблон задачи — `.gitlab/issue_templates/task.md`. Планы — `docs/roadmap.md`.
