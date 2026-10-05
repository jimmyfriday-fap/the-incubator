import 'package:go_router/go_router.dart';

// A test double: this router is not the app's.
final mock = GoRouter(routes: [GoRoute(path: '/mock', builder: (c, s) => throw 1)]);

void main() {}
