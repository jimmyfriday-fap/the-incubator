import 'package:flutter/material.dart';

void main() => runApp(const OrderDeskApp());

class OrderDeskApp extends StatelessWidget {
  const OrderDeskApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(home: Scaffold(body: Center(child: Text('Orders'))));
  }
}
