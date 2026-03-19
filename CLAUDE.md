# AirShadow Cabinet (форк bedolaga-cabinet)

## Что это

Форк [BEDOLAGA-DEV/bedolaga-cabinet](https://github.com/BEDOLAGA-DEV/bedolaga-cabinet) с кастомизациями для AirShadow VPN.

- `origin` — наш форк: `Air-Erik/bedolaga-cabinet`
- `upstream` — оригинал: `BEDOLAGA-DEV/bedolaga-cabinet`
- Ветка `main` — синхронизирована с upstream (чистый bedolaga)
- Ветка `airshadow-custom` — наши кастомизации поверх main

## VPS деплой

Кабинет деплоится как **статические файлы** на VPS `193.168.197.22` (root, ключ `C:\Users\user\.ssh\air-shadow`).

- Исходники на сервере: `/opt/bedolaga-cabinet`
- Статика: `/srv/cabinet` (раздаётся nginx напрямую)
- Nginx конфиги: `/opt/remnawave/nginx/cabinet.conf`, `bedolaga-webhooks.conf`
- Docker-контейнер `cabinet_frontend` **не используется** — только для сборки

**ВАЖНО:** Все изменения делаем ЗДЕСЬ (локально), пушим в GitHub, затем применяем на VPS. Не редактировать файлы на сервере напрямую — они будут перезаписаны при следующем деплое.

## Как деплоить на VPS

Одно SSH-соединение (сервер блокирует при множественных подключениях):

```bash
ssh -i /c/Users/user/.ssh/air-shadow root@193.168.197.22
cd /opt/bedolaga-cabinet
git fetch --all --tags
git checkout airshadow-custom
git pull

# Сборка
docker compose build --no-cache

# Извлечь статику
docker create --name tmp_cabinet bedolaga-cabinet-cabinet-frontend:latest
rm -rf /srv/cabinet/*
docker cp tmp_cabinet:/usr/share/nginx/html/. /srv/cabinet/
docker rm tmp_cabinet

# Применить
docker exec remnawave-nginx nginx -s reload
```

## Как обновить upstream (новая версия bedolaga)

```bash
# Локально
git fetch upstream --tags
git checkout main
git merge upstream/main
git push origin main

# Перебазировать кастомизации
git checkout airshadow-custom
git rebase main
# Если конфликты — разрешить вручную
git push origin airshadow-custom --force-with-lease

# Затем задеплоить на VPS (см. выше)
```

## Наши кастомизации (ветка airshadow-custom)

Все изменения в одном коммите для простоты rebase:

1. **Убрана страница "Информация"** из всех меню (desktop, mobile, sidebar)
   - `src/components/layout/AppShell/AppShell.tsx`
   - `src/components/layout/AppShell/AppHeader.tsx`
   - `src/components/layout/AppShell/DesktopSidebar.tsx`

2. **Лейблы навигации всегда видимы** (без expand-on-hover)
   - `src/components/layout/AppShell/AppShell.tsx`

3. **Только русский и английский языки**
   - `src/i18n.ts`
   - `src/components/LanguageSwitcher.tsx`

## Правила работы

- Все кастомизации коммитить в ветку `airshadow-custom`
- Не трогать ветку `main` — она зеркалит upstream
- При добавлении новых кастомизаций — коммитить отдельно (проще разрешать конфликты при rebase)
- После каждого изменения — деплоить на VPS по инструкции выше
- SSH: использовать одно соединение, не множественные параллельные
