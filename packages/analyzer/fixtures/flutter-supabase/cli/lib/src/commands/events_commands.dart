import 'base.dart';

class ListCommand extends ClubCommand {
  @override
  String get name => 'list';

  @override
  Future<int> run() async => 0;
}

class ShowCommand extends ClubCommand {
  @override
  String get name => 'show';

  @override
  Future<int> run() async => 0;
}
