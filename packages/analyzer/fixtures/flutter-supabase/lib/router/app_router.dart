import 'package:go_router/go_router.dart';

import '../features/admin/admin_dashboard.dart';
import '../features/auth/login_screen.dart';
import '../features/events/event_screen.dart';
import '../features/events/events_screen.dart';

const adminPath = '/admin';

final appRouter = GoRouter(
  routes: [
    ShellRoute(
      builder: (context, state, child) => child,
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const EventsScreen(),
        ),
        GoRoute(
          path: '/events/:eventId',
          builder: (context, state) {
            return EventScreen(eventId: state.pathParameters['eventId']!);
          },
        ),
      ],
    ),
    GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
    GoRoute(path: adminPath, builder: (context, state) => const AdminDashboard()),
  ],
);
