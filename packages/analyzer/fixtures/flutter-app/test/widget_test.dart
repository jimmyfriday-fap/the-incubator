import 'package:flutter_test/flutter_test.dart';
import 'package:order_desk/main.dart';

void main() {
  testWidgets('shows the orders heading', (tester) async {
    await tester.pumpWidget(const OrderDeskApp());
    expect(find.text('Orders'), findsOneWidget);
  });
}
