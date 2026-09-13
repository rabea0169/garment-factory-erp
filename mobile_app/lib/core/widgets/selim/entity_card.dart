import 'package:flutter/material.dart';

/// بطاقة كيان في القوائم — نمط قائمة Selim ERP للجوال.
///
/// السطر المُطوي: أيقونة + رقم المستند (mono) + شارة الحالة + المبلغ
/// ومعلومات ثانوية. عند التوسيع تظهر البنود والإجراءات كصف أزرار
/// بعرض كامل (أفضل من جداول على شاشة الهاتف — نفس قرار Selim).
///
/// ```dart
/// EntityCard(
///   leadingIcon: Icons.receipt_long_rounded,
///   iconColor: AppColors.primary,
///   title: 'شركة النور للتجارة',
///   badge: EntityBadge('غير مدفوع', AppColors.error),
///   subtitle: 'QUO-0042 · 13/09/2026',
///   amount: '2,850.00 ج.م',
///   meta: '3 أصناف · صالح حتى 01/10',
///   actions: [EntityAction('تحويل لأمر بيع', Icons.swap_horiz, () {})],
///   expandable: EntityExpandable(rows: [...], children: [...]),
/// )
/// ```
class EntityCard extends StatefulWidget {
  const EntityCard({
    super.key,
    required this.leadingIcon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    this.badge,
    this.amount,
    this.amountColor,
    this.meta,
    this.actions = const <EntityAction>[],
    this.expandRows = const <ExpandRow>[],
    this.expandChildren = const <Widget>[],
    this.onTap,
  });

  final IconData leadingIcon;
  final Color iconColor;
  final String title;

  /// شارة الحالة الملونة أعلى البطاقة.
  final EntityBadge? badge;

  /// سطر ثانوي: رقم المستند · التاريخ.
  final String subtitle;

  /// المبلغ الرئيسي (اختياري — يظهر LTR في يسار البطاقة).
  final String? amount;
  final Color? amountColor;

  /// معلومات إضافية صغيرة تحت العنوان.
  final String? meta;

  /// إجراءات تظهر عند التوسيع.
  final List<EntityAction> actions;

  /// صفوف تفصيلية (اسم → قيمة) تظهر عند التوسيع قبل الإجراءات.
  final List<ExpandRow> expandRows;

  /// ويدجت حرة إضافية داخل التوسيع (بنود الفاتورة مثلًا).
  final List<Widget> expandChildren;

  /// نقرة السطر المطوي توسّع البطاقة (أو onTap مخصص).
  final VoidCallback? onTap;

  @override
  State<EntityCard> createState() => _EntityCardState();
}

class _EntityCardState extends State<EntityCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final hasExpansion =
        widget.actions.isNotEmpty ||
        widget.expandRows.isNotEmpty ||
        widget.expandChildren.isNotEmpty;
    return Card(
      margin: const EdgeInsetsDirectional.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      elevation: 0.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Column(
        children: [
          InkWell(
            onTap: widget.onTap ??
                (hasExpansion
                    ? () => setState(() => _expanded = !_expanded)
                    : null),
            child: Padding(
              padding: const EdgeInsetsDirectional.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
              child: Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: widget.iconColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(widget.leadingIcon, color: widget.iconColor, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                widget.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontFamily: 'Cairo',
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            if (widget.badge != null) ...[
                              const SizedBox(width: 8),
                              widget.badge!,
                            ],
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          widget.subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: 'Cairo',
                            fontSize: 11.5,
                            color: Colors.grey.shade600,
                          ),
                        ),
                        if (widget.meta != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            widget.meta!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'Cairo',
                              fontSize: 10.5,
                              color: Colors.grey.shade500,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (widget.amount != null) ...[
                    const SizedBox(width: 8),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: Text(
                        widget.amount!,
                        style: TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color: widget.amountColor ?? Colors.black87,
                        ),
                      ),
                    ),
                  ],
                  if (hasExpansion)
                    AnimatedRotation(
                      turns: _expanded ? 0.5 : 0,
                      duration: const Duration(milliseconds: 180),
                      child: Icon(
                        Icons.keyboard_arrow_down_rounded,
                        color: Colors.grey.shade400,
                      ),
                    ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 180),
            crossFadeState: _expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            firstChild: const SizedBox(width: double.infinity, height: 0),
            secondChild: Column(
              children: [
                const Divider(height: 1),
                if (widget.expandRows.isNotEmpty)
                  Padding(
                    padding: const EdgeInsetsDirectional.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    child: Column(
                      children: widget.expandRows
                          .map((row) => _ExpandRowTile(row: row))
                          .toList(),
                    ),
                  ),
                ...widget.expandChildren,
                if (widget.actions.isNotEmpty)
                  Padding(
                    padding: const EdgeInsetsDirectional.fromSTEB(12, 4, 12, 12),
                    child: Row(
                      children: widget.actions
                          .map(
                            (action) => Expanded(
                              child: Padding(
                                padding: const EdgeInsetsDirectional.only(
                                  start: 4,
                                ),
                                child: _ActionButton(action: action),
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ExpandRowTile extends StatelessWidget {
  const _ExpandRowTile({required this.row});

  final ExpandRow row;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(
              row.label,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: Colors.grey.shade600,
              ),
            ),
          ),
          Expanded(
            child: Directionality(
              textDirection: TextDirection.ltr,
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  row.value,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.action});

  final EntityAction action;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: action.onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: action.color,
        side: BorderSide(color: action.color.withValues(alpha: 0.4)),
        padding: const EdgeInsetsDirectional.symmetric(horizontal: 6, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        minimumSize: const Size(0, 38),
      ),
      icon: Icon(action.icon, size: 15),
      label: Flexible(
        child: Text(
          action.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontFamily: 'Cairo', fontSize: 11),
        ),
      ),
    );
  }
}

/// شارة حالة ملونة صغيرة.
class EntityBadge extends StatelessWidget {
  const EntityBadge(this.label, this.color, {super.key});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: 'Cairo',
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}

class EntityAction {
  const EntityAction(this.label, this.icon, this.onTap, {this.color = const Color(0xFF1565C0)});

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final Color color;
}

class ExpandRow {
  const ExpandRow(this.label, this.value);
  final String label;
  final String value;
}
