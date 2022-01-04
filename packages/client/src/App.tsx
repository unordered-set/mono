import {CreditDesk} from "@goldfinch-eng/protocol/typechain/web3/CreditDesk"
import {GoldfinchConfig} from "@goldfinch-eng/protocol/typechain/web3/GoldfinchConfig"
import * as Sentry from "@sentry/react"
import React, {useEffect, useState} from "react"
import {BrowserRouter as Router, Redirect, Route, Switch} from "react-router-dom"
import {ThemeProvider} from "styled-components"
import {ApolloClient, ApolloProvider, NormalizedCacheObject} from "@apollo/client"
import Borrow from "./components/borrow"
import DevTools from "./components/devTools"
import Earn from "./components/earn"
import Footer from "./components/footer"
import SeniorPoolView from "./components/pools/seniorPoolView"
import TranchedPoolView from "./components/pools/tranchedPoolView"
import PrivacyPolicy from "./components/privacyPolicy"
import SeniorPoolAgreementNonUS from "./components/seniorPoolAgreementNonUS"
import Sidebar from "./components/sidebar"
import TermsOfService from "./components/termsOfService"
import Transactions from "./components/transactions"
import VerifyIdentity from "./components/verifyIdentity"
import {BorrowProvider} from "./contexts/BorrowContext"
import {EarnProvider} from "./contexts/EarnContext"
import {CommunityRewards, CommunityRewardsLoaded} from "./ethereum/communityRewards"
import {ERC20, Tickers} from "./ethereum/erc20"
import {GFI, GFILoaded} from "./ethereum/gfi"
import {GoldfinchConfigData, refreshGoldfinchConfigData} from "./ethereum/goldfinchConfig"
import {GoldfinchProtocol} from "./ethereum/GoldfinchProtocol"
import {NetworkMonitor} from "./ethereum/networkMonitor"
import {SeniorPool, SeniorPoolLoaded, StakingRewards, StakingRewardsLoaded} from "./ethereum/pool"
import {CurrentTx, TxType} from "./types/transactions"
import {
  getUserData,
  UserCommunityRewards,
  UserCommunityRewardsLoaded,
  UserLoaded,
  UserMerkleDirectDistributor,
  UserMerkleDirectDistributorLoaded,
  UserMerkleDistributor,
  UserMerkleDistributorLoaded,
} from "./ethereum/user"
import {mapNetworkToID, SUPPORTED_NETWORKS} from "./ethereum/utils"
import {useFromSameBlock} from "./hooks/useFromSameBlock"
import {useSessionLocalStorage} from "./hooks/useSignIn"
import Rewards from "./pages/rewards"
import {defaultTheme} from "./styles/theme"
import {assertWithLoadedInfo} from "./types/loadable"
import {SessionData} from "./types/session"
import {assertNonNullable, BlockInfo, getBlockInfo, getCurrentBlock} from "./utils"
import web3, {SESSION_DATA_KEY} from "./web3"
import {Web3Status} from "./types/web3"
import {NetworkConfig} from "./types/network"
import getApolloClient from "./graphql/client"
import NetworkIndicators from "./components/networkIndicators"
import {MerkleDistributor, MerkleDistributorLoaded} from "./ethereum/merkleDistributor"
import {
  ABOUT_ROUTE,
  AppRoute,
  BORROW_ROUTE,
  EARN_ROUTE,
  INDEX_ROUTE,
  PRIVACY_POLICY_ROUTE,
  REWARDS_ROUTE,
  SENIOR_POOL_AGREEMENT_NON_US_ROUTE,
  SENIOR_POOL_ROUTE,
  TERMS_OF_SERVICE_ROUTE,
  TRANCHED_POOL_ROUTE,
  TRANSACTIONS_ROUTE,
  VERIFY_ROUTE,
} from "./types/routes"
import {MerkleDirectDistributor, MerkleDirectDistributorLoaded} from "./ethereum/merkleDirectDistributor"

interface GeolocationData {
  ip: string
  city: string
  region: string
  country: string
  loc: string
  org: string
  postal: string
  timezone: string
}

export type SetSessionFn = (data: SessionData | undefined) => void

export type LeavesCurrentBlock = Record<AppRoute, BlockInfo | undefined>

export interface GlobalState {
  web3Status?: Web3Status

  // This tracks the latest block that the application knows about. Think of this as a
  // global or root-level piece of state; it applies to the entire application.
  currentBlock?: BlockInfo
  // This handler is for use whenever something has happened (e.g. the user took some action)
  // to which we want to react by refreshing chain data (and values derived thereof). Refreshing
  // the application's understanding of the current block is meant to be sufficient (i.e. it's
  // the developer's responsibility to accomplish this) to trigger cascading refreshing of the
  // data depended on by the mounted components in the component tree.
  refreshCurrentBlock?: () => Promise<void>
  // This tracks the latest block that the application knows about *at the respective leaf of the
  // component tree*, that is, which corresponds to the chain data being shown to the user on a
  // given route. Tracking this separately from `currentBlock` is useful because it enables us --
  // assuming the developer has implemented the necessary usage of `refreshCurrentBlock()` to trigger
  // refreshing, and of `setLeafCurrentBlock()` when the refresh has finished as far as a given
  // route is concerned -- to display an indicator in the UI that the chain data are being refreshed,
  // if the leaf's current block is lagging behind the `currentBlock`.
  leavesCurrentBlock?: LeavesCurrentBlock
  // This setter should be called when the "last" data dependency of a view has finished refreshing,
  // as defined by a change (increase) in the current block associated with that data dependency; the
  // setter should be called with that new current block. What is meant by "last"? It's the data
  // dependency that can be thought of being the closest to a leaf node of the component tree. The
  // point is that once it's done refreshing, we know that nothing else remains to be refreshed. In
  // practice, this means we'll want to call `setLeafCurrentBlock()` once per application route.
  setLeafCurrentBlock?: (route: AppRoute, leafCurrentBlock: BlockInfo) => void

  gfi?: GFILoaded
  stakingRewards?: StakingRewardsLoaded
  communityRewards?: CommunityRewardsLoaded
  merkleDistributor?: MerkleDistributorLoaded
  merkleDirectDistributor?: MerkleDirectDistributorLoaded
  userMerkleDistributor?: UserMerkleDistributorLoaded
  userMerkleDirectDistributor?: UserMerkleDirectDistributorLoaded
  userCommunityRewards?: UserCommunityRewardsLoaded
  pool?: SeniorPoolLoaded
  creditDesk?: CreditDesk
  user?: UserLoaded
  usdc?: ERC20
  goldfinchConfig?: GoldfinchConfigData
  goldfinchProtocol?: GoldfinchProtocol

  network?: NetworkConfig
  networkMonitor?: NetworkMonitor

  geolocationData?: GeolocationData
  setGeolocationData?: (geolocationData: GeolocationData) => void

  sessionData?: SessionData
  setSessionData?: SetSessionFn
}

declare let window: any

const AppContext = React.createContext<GlobalState>({})

function App() {
  const [web3Status, setWeb3Status] = useState<Web3Status>()
  const [_gfi, setGfi] = useState<GFILoaded>()
  const [_stakingRewards, setStakingRewards] = useState<StakingRewardsLoaded>()
  const [_communityRewards, setCommunityRewards] = useState<CommunityRewardsLoaded>()
  const [_merkleDistributor, setMerkleDistributor] = useState<MerkleDistributorLoaded>()
  const [_merkleDirectDistributor, setMerkleDirectDistributor] = useState<MerkleDirectDistributorLoaded>()
  const [pool, setPool] = useState<SeniorPoolLoaded>()
  const [userMerkleDistributor, setUserMerkleDistributor] = useState<UserMerkleDistributorLoaded>()
  const [userMerkleDirectDistributor, setUserMerkleDirectDistributor] = useState<UserMerkleDirectDistributorLoaded>()
  const [userCommunityRewards, setUserCommunityRewards] = useState<UserCommunityRewardsLoaded>()
  const [creditDesk, setCreditDesk] = useState<CreditDesk>()
  const [usdc, setUSDC] = useState<ERC20>()
  const [overrideAddress, setOverrideAdress] = useState<string>()
  const [user, setUser] = useState<UserLoaded>()
  const [currentBlock, setCurrentBlock] = useState<BlockInfo>()
  const [leavesCurrentBlock, setLeavesCurrentBlock] = useState<LeavesCurrentBlock>({
    [INDEX_ROUTE]: undefined,
    [EARN_ROUTE]: undefined,
    [ABOUT_ROUTE]: undefined,
    [REWARDS_ROUTE]: undefined,
    [BORROW_ROUTE]: undefined,
    [TRANSACTIONS_ROUTE]: undefined,
    [SENIOR_POOL_ROUTE]: undefined,
    [TRANCHED_POOL_ROUTE]: undefined,
    [VERIFY_ROUTE]: undefined,
    [TERMS_OF_SERVICE_ROUTE]: undefined,
    [PRIVACY_POLICY_ROUTE]: undefined,
    [SENIOR_POOL_AGREEMENT_NON_US_ROUTE]: undefined,
  })
  const [goldfinchConfig, setGoldfinchConfig] = useState<GoldfinchConfigData>()
  const [currentTxs, setCurrentTxs] = useState<CurrentTx<TxType>[]>([])
  const [currentErrors, setCurrentErrors] = useState<any[]>([])
  const [network, setNetwork] = useState<NetworkConfig>()
  const [networkMonitor, setNetworkMonitor] = useState<NetworkMonitor>()
  const [goldfinchProtocol, setGoldfinchProtocol] = useState<GoldfinchProtocol>()
  const [geolocationData, setGeolocationData] = useState<GeolocationData>()
  const {localStorageValue: sessionData, setLocalStorageValue: setSessionData} = useSessionLocalStorage(
    SESSION_DATA_KEY,
    {},
    currentBlock?.timestamp
  )
  const consistent = useFromSameBlock(
    {setAsLeaf: false},
    currentBlock,
    _gfi,
    _stakingRewards,
    _communityRewards,
    _merkleDistributor,
    _merkleDirectDistributor
  )
  const gfi = consistent?.[0]
  const stakingRewards = consistent?.[1]
  const communityRewards = consistent?.[2]
  const merkleDistributor = consistent?.[3]
  const merkleDirectDistributor = consistent?.[4]

  // To ensure `gfi`, `stakingRewards`, `communityRewards`, `merkleDistributor`,
  // `merkleDirectDistributor`, and `pool` are from the same block, we'd use `useFromSameBlock()`
  // again here. But holding off on that due to the decision to abandon
  // https://github.com/warbler-labs/mono/pull/140.

  const toggleRewards = process.env.REACT_APP_TOGGLE_REWARDS === "true"
  const [apolloClient, setApolloClient] = useState<ApolloClient<NormalizedCacheObject>>(getApolloClient(undefined))

  useEffect(() => {
    setupWeb3()

    // Admin function to be able to assume the role of any address
    window.setUserAddress = function (overrideAddress: string) {
      setOverrideAdress(overrideAddress)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setApolloClient(getApolloClient(network))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network])

  useEffect(() => {
    if (goldfinchProtocol && currentBlock) {
      refreshGfiAndRewards()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goldfinchProtocol, currentBlock])

  useEffect(() => {
    if (goldfinchProtocol && stakingRewards && gfi && currentBlock) {
      refreshPool()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stakingRewards, gfi])

  useEffect(() => {
    if (
      goldfinchProtocol &&
      communityRewards &&
      merkleDistributor &&
      merkleDirectDistributor &&
      web3Status &&
      web3Status.type === "connected" &&
      currentBlock
    ) {
      refreshUserMerkleAndCommunityRewardsInfo(web3Status.address, overrideAddress)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityRewards, merkleDistributor, merkleDirectDistributor, web3Status?.address, overrideAddress])

  useEffect(() => {
    if (
      goldfinchProtocol &&
      pool &&
      creditDesk &&
      network &&
      stakingRewards &&
      gfi &&
      communityRewards &&
      merkleDistributor &&
      merkleDirectDistributor &&
      web3Status &&
      web3Status.type === "connected" &&
      currentBlock
    ) {
      refreshUserData(web3Status.address, overrideAddress)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdc, pool, web3Status?.address, overrideAddress])

  // To ensure the data dependencies of `user` *and* `user` itself are from the same block,
  // we'd use `useFromSameBlock()` again here. But holding off on that due to the decision to abandon
  // https://github.com/warbler-labs/mono/pull/140.

  async function getWeb3Status(): Promise<Web3Status> {
    if (!window.ethereum) {
      return {type: "no_web3", networkName: undefined, address: undefined}
    }
    let networkName: string
    try {
      // Sometimes it's possible that we can't communicate with the provider, in which case
      // treat as if we don't have web3.
      networkName = await web3.eth.net.getNetworkType()
      if (!networkName) {
        throw new Error("Falsy network type.")
      }
    } catch (e) {
      return {type: "no_web3", networkName: undefined, address: undefined}
    }
    const accounts = await web3.eth.getAccounts()
    const address = accounts[0]
    if (address) {
      return {type: "connected", networkName, address}
    } else {
      return {type: "has_web3", networkName, address: undefined}
    }
  }

  async function setupWeb3() {
    const _web3Status = await getWeb3Status()
    setWeb3Status(_web3Status)
    if (_web3Status.type === "no_web3") {
      return
    }

    const networkId = mapNetworkToID[_web3Status.networkName] || _web3Status.networkName
    const name = networkId
    const supported = SUPPORTED_NETWORKS[networkId] || false
    const networkConfig: NetworkConfig = {name, supported}
    setNetwork(networkConfig)
    if (networkConfig.supported) {
      const currentBlock = getBlockInfo(await getCurrentBlock())

      const protocol = new GoldfinchProtocol(networkConfig)
      await protocol.initialize()

      const usdc = await protocol.getERC20(Tickers.USDC)

      const goldfinchConfigContract = protocol.getContract<GoldfinchConfig>("GoldfinchConfig")
      const goldfinchConfigData = await refreshGoldfinchConfigData(goldfinchConfigContract, currentBlock)

      const creditDeskContract = protocol.getContract<CreditDesk>("CreditDesk")

      setCurrentBlock(currentBlock)
      setUSDC(usdc)
      setCreditDesk(creditDeskContract)
      setGoldfinchConfig(goldfinchConfigData)
      setGoldfinchProtocol(protocol)

      const monitor = new NetworkMonitor(web3, {
        setCurrentTxs,
        setCurrentErrors,
      })
      monitor.initialize(currentBlock) // initialize async, no need to block on this
      setNetworkMonitor(monitor)
    }
  }

  async function refreshGfiAndRewards(): Promise<void> {
    assertNonNullable(goldfinchProtocol)
    assertNonNullable(currentBlock)

    const gfi = new GFI(goldfinchProtocol)
    const stakingRewards = new StakingRewards(goldfinchProtocol)
    const communityRewards = new CommunityRewards(goldfinchProtocol)
    const merkleDistributor = new MerkleDistributor(goldfinchProtocol)
    const merkleDirectDistributor = new MerkleDirectDistributor(goldfinchProtocol)

    await Promise.all([
      gfi.initialize(currentBlock),
      stakingRewards.initialize(currentBlock),
      communityRewards.initialize(currentBlock),
      merkleDistributor.initialize(currentBlock),
      merkleDirectDistributor.initialize(currentBlock),
    ])

    assertWithLoadedInfo(gfi)
    assertWithLoadedInfo(stakingRewards)
    assertWithLoadedInfo(communityRewards)
    assertWithLoadedInfo(merkleDistributor)
    assertWithLoadedInfo(merkleDirectDistributor)

    setGfi(gfi)
    setStakingRewards(stakingRewards)
    setCommunityRewards(communityRewards)
    setMerkleDistributor(merkleDistributor)
    setMerkleDirectDistributor(merkleDirectDistributor)
  }

  async function refreshPool(): Promise<void> {
    assertNonNullable(goldfinchProtocol)
    assertNonNullable(currentBlock)
    assertNonNullable(stakingRewards)
    assertNonNullable(gfi)

    const pool = new SeniorPool(goldfinchProtocol)
    await pool.initialize(stakingRewards, gfi, currentBlock)
    assertWithLoadedInfo(pool)

    setPool(pool)
  }

  async function refreshUserMerkleAndCommunityRewardsInfo(
    userAddress: string,
    overrideAddress: string | undefined
  ): Promise<void> {
    assertNonNullable(goldfinchProtocol)
    assertNonNullable(currentBlock)
    assertNonNullable(communityRewards)
    assertNonNullable(merkleDistributor)
    assertNonNullable(merkleDirectDistributor)

    const address = overrideAddress || userAddress

    const userMerkleDistributor = new UserMerkleDistributor(address, goldfinchProtocol)
    const userMerkleDirectDistributor = new UserMerkleDirectDistributor(address, goldfinchProtocol)
    await Promise.all([
      userMerkleDistributor.initialize(merkleDistributor, communityRewards, currentBlock),
      userMerkleDirectDistributor.initialize(merkleDirectDistributor, currentBlock),
    ])
    assertWithLoadedInfo(userMerkleDistributor)
    assertWithLoadedInfo(userMerkleDirectDistributor)

    const userCommunityRewards = new UserCommunityRewards(address, goldfinchProtocol)
    await userCommunityRewards.initialize(communityRewards, merkleDistributor, userMerkleDistributor, currentBlock)
    assertWithLoadedInfo(userCommunityRewards)

    setUserMerkleDistributor(userMerkleDistributor)
    setUserMerkleDirectDistributor(userMerkleDirectDistributor)
    setUserCommunityRewards(userCommunityRewards)
  }

  async function refreshUserData(userAddress: string, overrideAddress: string | undefined): Promise<void> {
    assertNonNullable(goldfinchProtocol)
    assertNonNullable(pool)
    assertNonNullable(creditDesk)
    assertNonNullable(network)
    assertNonNullable(currentBlock)
    assertNonNullable(stakingRewards)
    assertNonNullable(gfi)
    assertNonNullable(communityRewards)
    assertNonNullable(merkleDistributor)
    assertNonNullable(merkleDirectDistributor)

    const address = overrideAddress || userAddress
    const user = await getUserData(
      address,
      goldfinchProtocol,
      pool,
      creditDesk,
      network.name,
      stakingRewards,
      gfi,
      communityRewards,
      merkleDistributor,
      merkleDirectDistributor,
      currentBlock
    )

    Sentry.setUser({
      // NOTE: The info we use here to identify / define the user for the purpose of
      // error tracking with Sentry MUST be kept consistent with (i.e. not exceed
      // the bounds set by) what our Terms of Service, Privacy Policy, and marketing
      // copy state about the identifying information that Goldfinch stores.
      id: user.address,
      address: user.address,
      isOverrideOf: overrideAddress ? userAddress : undefined,
    })

    setUser(user)
  }

  async function refreshCurrentBlock(): Promise<void> {
    const currentBlock = getBlockInfo(await getCurrentBlock())
    setCurrentBlock(currentBlock)
  }

  function setLeafCurrentBlock(route: AppRoute, leafCurrentBlock: BlockInfo) {
    setLeavesCurrentBlock({...leavesCurrentBlock, [route]: leafCurrentBlock})
  }

  const store: GlobalState = {
    web3Status,
    currentBlock,
    leavesCurrentBlock,
    stakingRewards,
    gfi,
    communityRewards,
    merkleDistributor,
    merkleDirectDistributor,
    pool,
    creditDesk,
    user,
    userMerkleDistributor,
    userMerkleDirectDistributor,
    userCommunityRewards,
    usdc,
    goldfinchConfig,
    network,
    networkMonitor,
    goldfinchProtocol,
    geolocationData,
    setGeolocationData,
    sessionData,
    setSessionData,
    refreshCurrentBlock,
    setLeafCurrentBlock,
  }

  return (
    <ApolloProvider client={apolloClient}>
      <AppContext.Provider value={store}>
        <ThemeProvider theme={defaultTheme}>
          <EarnProvider>
            <BorrowProvider>
              <Router>
                <NetworkIndicators
                  user={user}
                  network={network}
                  currentErrors={currentErrors}
                  currentTxs={currentTxs}
                  connectionComplete={setupWeb3}
                  rootCurrentBlock={currentBlock}
                  leavesCurrentBlock={leavesCurrentBlock}
                />
                {(process.env.NODE_ENV === "development" || process.env.MURMURATION === "yes") && <DevTools />}
                <Sidebar />
                <div>
                  <Switch>
                    <Route exact path={INDEX_ROUTE}>
                      <Redirect to={EARN_ROUTE} />
                    </Route>
                    <Route path={ABOUT_ROUTE}>{/* <About /> */}</Route>
                    <Route path={EARN_ROUTE}>
                      <Earn />
                    </Route>
                    {toggleRewards && (
                      <Route path={REWARDS_ROUTE}>
                        <Rewards />
                      </Route>
                    )}
                    <Route path={BORROW_ROUTE}>
                      <Borrow />
                    </Route>
                    <Route path={TRANSACTIONS_ROUTE}>
                      <Transactions currentTxs={currentTxs} />
                    </Route>
                    <Route path={SENIOR_POOL_ROUTE}>
                      <SeniorPoolView />
                    </Route>
                    <Route path={TRANCHED_POOL_ROUTE}>
                      <TranchedPoolView />
                    </Route>
                    <Route path={VERIFY_ROUTE}>
                      <VerifyIdentity />
                    </Route>
                    <Route path={TERMS_OF_SERVICE_ROUTE}>
                      <TermsOfService />
                    </Route>
                    <Route path={PRIVACY_POLICY_ROUTE}>
                      <PrivacyPolicy />
                    </Route>
                    <Route path={SENIOR_POOL_AGREEMENT_NON_US_ROUTE}>
                      <SeniorPoolAgreementNonUS />
                    </Route>
                  </Switch>
                </div>
              </Router>
            </BorrowProvider>
          </EarnProvider>
          <Footer />
        </ThemeProvider>
      </AppContext.Provider>
    </ApolloProvider>
  )
}

export {App, AppContext}
export type {GeolocationData}
