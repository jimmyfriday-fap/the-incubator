enum UserRole { admin, organizer, member }

class Profile {
  const Profile({required this.id, required this.role});

  final String id;
  final UserRole role;
}
