import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/profile.dart';

final eventsProvider =
    FutureProvider.autoDispose<List<String>>((ref) async => <String>[]);

final currentRoleProvider = StateProvider<UserRole>((ref) => UserRole.member);

final notAProvider = 'ignored';
