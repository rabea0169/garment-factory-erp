import '../../core/network/api_client.dart';
import 'data/datasources/production_remote_data_source.dart';
import 'data/repositories/production_repository_impl.dart';
import 'domain/repositories/production_repository.dart';
import 'domain/usecases/production_usecases.dart';
import 'presentation/cubit/production_cubit.dart';

ProductionCubit createProductionCubit({ApiClient? apiClient}) {
  final client = apiClient ?? ApiClient.instance;
  final remote = ProductionRemoteDataSource(client.dio);
  final ProductionRepository repository = ProductionRepositoryImpl(remote);

  return ProductionCubit(
    getWorkOrders: GetWorkOrders(repository),
    transitionStage: TransitionProductionStage(repository),
    recordStageOutput: RecordProductionStageOutput(repository),
    consumeMaterial: ConsumeProductionMaterial(repository),
    finalizeCost: FinalizeProductionCost(repository),
  );
}
