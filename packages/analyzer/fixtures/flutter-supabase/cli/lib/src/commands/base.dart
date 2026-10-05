import 'package:args/command_runner.dart';

abstract class ClubCommand extends Command<int> {
  @override
  String get description => 'a club command';
}
