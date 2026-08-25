# HANDOFF_TEMPLATE

> انسخ هذا القالب لكل بطاقة تسليم جديدة باسم `HANDOFF-###.md`. لا تُغلق مهمة بدونه.

```markdown
# Handoff ###

## Status
- Branch:
- Commit:
- Phase:
- Task ID:
- Date:

## Completed
-

## Files Changed
-

## Database/API Impact
-

## Checks
| Check | Result | Notes |
|---|---|---|
| Build (npm run build) | | |
| Backend tests (npm test --runInBand) | | |
| Lint (npm run lint) | | |
| Prisma validate | | |
| Flutter analyze/test | | — إن لم تُشغل، اذكر السبب |
| Security scan | | |

## Known Issues
-

## Not Done
-

## Next Exact Task
```text
TASK_ID:
TITLE:
OBJECTIVE:
ALLOWED FILES:
ACCEPTANCE CRITERIA:
```

## Rollback
-
```

## قواعد بطاقة التسليم

1. المهمة التالية **مهمة دقيقة واحدة** بملفاتها ومعايير قبولها — ليست "تحسين عام".
2. كل نتيجة فحص تُسجل كما هي؛ لا تخفي فشلًا.
3. أي انحراف عن Allowed Files يُبرر صراحة في قسم مستقل.
4. آخر سطر دائمًا: كيف يتراجع النموذج التالي بأمان لو احتاج.
