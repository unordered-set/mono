/* global web3 */
import BN from "bn.js"
import hre from "hardhat"
import {expectEvent} from "@openzeppelin/test-helpers"
import {DISTRIBUTOR_ROLE, OWNER_ROLE} from "../blockchain_scripts/deployHelpers"
import {GFIInstance} from "../typechain/truffle"
import {Granted, GrantRevoked, RewardAdded, RewardPaid} from "../typechain/truffle/CommunityRewards"
import {TestCommunityRewardsInstance} from "../typechain/truffle/TestCommunityRewards"
import {mintAndLoadRewards} from "./communityRewardsHelpers"
import {advanceTime, decodeLogs, deployAllContracts, expect, getCurrentTimestamp, getOnlyLog} from "./testHelpers"
const {ethers} = hre
const {deployments} = hre

describe("CommunityRewards", () => {
  let owner: string, anotherUser: string, gfi: GFIInstance, communityRewards: TestCommunityRewardsInstance

  beforeEach(async () => {
    ;[owner, anotherUser] = await web3.eth.getAccounts()
    ;({gfi, communityRewards} = await deployAllContracts(deployments))
  })

  async function grant({
    recipient,
    amount,
    vestingLength,
    cliffLength,
    vestingInterval,
  }: {
    recipient: string
    amount: BN
    vestingLength: BN
    cliffLength: BN
    vestingInterval: BN
  }): Promise<BN> {
    const rewardsAvailableBefore = await communityRewards.rewardsAvailable()

    const receipt = await communityRewards.grant(recipient, amount, vestingLength, cliffLength, vestingInterval, {
      from: owner,
    })

    const rewardsAvailableAfter = await communityRewards.rewardsAvailable()

    const grantedEvent = getOnlyLog<Granted>(decodeLogs(receipt.receipt.rawLogs, communityRewards, "Granted"))
    const tokenId = grantedEvent.args.tokenId

    // Verify rewards available state.
    expect(rewardsAvailableBefore.sub(rewardsAvailableAfter)).to.bignumber.equal(amount)

    // Verify grant state.
    const currentTimestamp = await getCurrentTimestamp()
    const grantState = await communityRewards.getGrant(tokenId)
    expect(grantState.totalGranted).to.bignumber.equal(amount)
    expect(grantState.totalClaimed).to.bignumber.equal(new BN(0))
    expect(grantState.startTime).to.bignumber.equal(currentTimestamp)
    expect(grantState.endTime).to.bignumber.equal(new BN(grantState.startTime).add(vestingLength))
    expect(grantState.cliffLength).to.bignumber.equal(cliffLength)
    expect(grantState.vestingInterval).to.bignumber.equal(vestingInterval)
    expect(grantState.revokedAt).to.bignumber.equal(new BN(0))

    // Verify that NFT was minted that is owned by recipient.
    expect(await communityRewards.ownerOf(tokenId)).to.equal(anotherUser)

    // Verify that event was emitted.
    expect(grantedEvent.args.user).to.equal(recipient)
    expect(grantedEvent.args.amount).to.bignumber.equal(amount)
    expect(grantedEvent.args.vestingLength).to.bignumber.equal(vestingLength)
    expect(grantedEvent.args.cliffLength).to.bignumber.equal(cliffLength)
    expect(grantedEvent.args.vestingInterval).to.bignumber.equal(vestingInterval)

    return new BN(tokenId)
  }

  describe("grant", () => {
    beforeEach(async () => {
      const amount = new BN(1e6)
      await mintAndLoadRewards(gfi, communityRewards, owner, amount)
    })

    it("allows owner who has distributor role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await communityRewards.hasRole(DISTRIBUTOR_ROLE, owner)).to.equal(true)
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: owner})).to
        .be.fulfilled
    })

    it("allows non-owner who has distributor role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, anotherUser)).to.equal(false)
      expect(await communityRewards.hasRole(DISTRIBUTOR_ROLE, anotherUser)).to.equal(false)
      await communityRewards.grantRole(DISTRIBUTOR_ROLE, anotherUser)
      expect(await communityRewards.hasRole(DISTRIBUTOR_ROLE, anotherUser)).to.equal(true)
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: owner})).to
        .be.fulfilled
    })

    it("rejects sender who lacks distributor role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, anotherUser)).to.equal(false)
      expect(await communityRewards.hasRole(DISTRIBUTOR_ROLE, anotherUser)).to.equal(false)
      await expect(
        communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: anotherUser})
      ).to.be.rejectedWith(/Must have distributor role to perform this action/)
    })

    it("rejects 0 grant amount", async () => {
      await expect(
        communityRewards.grant(anotherUser, new BN(0), new BN(0), new BN(0), new BN(1), {from: owner})
      ).to.be.rejectedWith(/Cannot grant 0 amount/)
    })

    it("allows 0 vesting length", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: owner})).to
        .be.fulfilled
    })

    it("allows > 0 vesting length", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(100), new BN(0), new BN(1), {from: owner}))
        .to.be.fulfilled
    })

    it("allows 0 cliff length", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: owner})).to
        .be.fulfilled
    })

    it("allows > 0 cliff length less than vesting length", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(100), new BN(10), new BN(1), {from: owner}))
        .to.be.fulfilled
    })

    it("allows > 0 cliff length equal to vesting length", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(100), new BN(100), new BN(1), {from: owner}))
        .to.be.fulfilled
    })

    it("rejects a cliff length that exceeds vesting length", async () => {
      await expect(
        communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(1), new BN(1), {from: owner})
      ).to.be.rejectedWith(/Cliff length cannot exceed vesting length/)
    })

    it("rejects a vesting interval of 0", async () => {
      await expect(
        communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(0), {from: owner})
      ).to.be.rejectedWith(/revert SafeMath: modulo by zero/)
    })

    it("allows a vesting interval of 1", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: owner})).to
        .be.fulfilled
    })

    it("allows a > 1 vesting interval that is a factor of vesting length", async () => {
      await expect(communityRewards.grant(anotherUser, new BN(1e3), new BN(6), new BN(0), new BN(3), {from: owner})).to
        .be.fulfilled
    })

    it("rejects a > 1 vesting interval that is not a factor of vesting length", async () => {
      await expect(
        communityRewards.grant(anotherUser, new BN(1e3), new BN(6), new BN(0), new BN(4), {from: owner})
      ).to.be.rejectedWith(/Vesting interval must be a factor of vesting length/)
    })

    it("rejects granting an amount that exceeds the available rewards", async () => {
      expect(await communityRewards.rewardsAvailable()).to.bignumber.equal(new BN(1e6))
      await expect(
        communityRewards.grant(anotherUser, new BN(1e6 + 1), new BN(0), new BN(0), new BN(1), {from: owner})
      ).to.be.rejectedWith(/Cannot grant amount due to insufficient funds/)
    })

    it("updates state, mints an NFT owned by the grant recipient, and emits an event", async () => {
      expect(await communityRewards.rewardsAvailable()).to.bignumber.equal(new BN(1e6))

      const tokenId = await grant({
        recipient: anotherUser,
        amount: new BN(1e3),
        vestingLength: new BN(0),
        cliffLength: new BN(0),
        vestingInterval: new BN(1),
      })

      // 1. State updates
      // Decrements available rewards.
      // (Established in `grant()`.)

      // Stores grant state.
      // (Established in `grant()`.)

      // Increments token id.
      const tokenId2 = await grant({
        recipient: anotherUser,
        amount: new BN(1e3),
        vestingLength: new BN(0),
        cliffLength: new BN(0),
        vestingInterval: new BN(1),
      })
      expect(tokenId2).to.bignumber.equal(tokenId.add(new BN(1)))

      // 2. NFT ownership
      // (Established in `grant()`.)

      // 3. Event behavior
      // (Established in `grant()`.)
    })

    context("paused", async () => {
      it("reverts", async () => {
        await communityRewards.pause()
        await expect(
          communityRewards.grant(anotherUser, new BN(1e3), new BN(0), new BN(0), new BN(1), {from: owner})
        ).to.be.rejectedWith(/paused/)
      })
    })
  })

  describe("loadRewards", async () => {
    const amount = new BN(1e3)

    beforeEach(async () => {
      await gfi.mint(owner, amount)
      await gfi.approve(communityRewards.address, amount)
    })

    it("rejects sender who lacks owner role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, anotherUser)).to.equal(false)
      await expect(communityRewards.loadRewards(amount, {from: anotherUser})).to.be.rejectedWith(
        /Must have admin role to perform this action/
      )
    })

    it("allows sender who has owner role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, owner)).to.equal(true)
      await expect(communityRewards.loadRewards(amount, {from: owner})).to.be.fulfilled
    })

    it("rejects 0 amount", async () => {
      await expect(communityRewards.loadRewards(new BN(0), {from: owner})).to.be.rejectedWith(/Cannot load 0 rewards/)
    })

    it("transfers GFI from sender, updates state, and emits an event", async () => {
      const gfiBalanceBefore = await gfi.balanceOf(communityRewards.address)
      expect(gfiBalanceBefore).to.bignumber.equal(new BN(0))

      const rewardsAvailableBefore = await communityRewards.rewardsAvailable()
      expect(rewardsAvailableBefore).to.bignumber.equal(new BN(0))

      const receipt = await communityRewards.loadRewards(amount, {from: owner})

      const gfiBalanceAfter = await gfi.balanceOf(communityRewards.address)
      expect(gfiBalanceAfter).to.bignumber.equal(amount)

      const rewardsAvailableAfter = await communityRewards.rewardsAvailable()
      expect(rewardsAvailableAfter).to.bignumber.equal(amount)

      const rewardAddedEvent = getOnlyLog<RewardAdded>(
        decodeLogs(receipt.receipt.rawLogs, communityRewards, "RewardAdded")
      )
      expect(rewardAddedEvent.args.reward).to.bignumber.equal(amount)
    })
  })

  describe("revokeGrant", async () => {
    let tokenId: BN
    let amount: BN
    let vestingLength: BN
    let grantedAt: BN

    beforeEach(async () => {
      amount = new BN(1e6)
      vestingLength = new BN(1000)
      await mintAndLoadRewards(gfi, communityRewards, owner, amount)
      tokenId = await grant({
        recipient: anotherUser,
        amount,
        vestingLength,
        cliffLength: new BN(0),
        vestingInterval: new BN(1),
      })
      grantedAt = await getCurrentTimestamp()
      await advanceTime({seconds: vestingLength.div(new BN(2))})
    })

    it("rejects sender who lacks owner role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, anotherUser)).to.equal(false)
      await expect(communityRewards.revokeGrant(tokenId, {from: anotherUser})).to.be.rejectedWith(
        /Must have admin role to perform this action/
      )
    })

    it("allows sender who has owner role", async () => {
      expect(await communityRewards.hasRole(OWNER_ROLE, owner)).to.equal(true)
      await expect(communityRewards.revokeGrant(tokenId, {from: owner})).to.be.fulfilled
    })

    it("rejects call for a non-existent token id", async () => {
      await expect(communityRewards.revokeGrant(tokenId.add(new BN(1)), {from: owner})).to.be.rejectedWith(
        /Grant not defined for token id/
      )
    })

    it("rejects if grant has already been revoked", async () => {
      await communityRewards.revokeGrant(tokenId, {from: owner})
      await expect(communityRewards.revokeGrant(tokenId, {from: owner})).to.be.rejectedWith(
        /Grant has already been revoked/
      )
    })

    it("rejects if grant has already fully vested", async () => {
      await ethers.provider.send("evm_mine", [])
      await advanceTime({seconds: vestingLength.div(new BN(2))})
      await expect(communityRewards.revokeGrant(tokenId, {from: owner})).to.be.rejectedWith(/Grant has fully vested/)
      const currentTimestamp = await getCurrentTimestamp()
      expect(currentTimestamp).to.bignumber.equal(grantedAt.add(vestingLength))
    })

    it("updates state and emits an event", async () => {
      const rewardsAvailableBefore = await communityRewards.rewardsAvailable()

      const receipt = await communityRewards.revokeGrant(tokenId, {from: owner})

      const expectedTotalUnvested = amount.div(new BN(2))

      // Increments rewards available.
      const rewardsAvailableAfter = await communityRewards.rewardsAvailable()
      expect(rewardsAvailableAfter.sub(rewardsAvailableBefore)).to.bignumber.equal(expectedTotalUnvested)

      // Sets revoked-at timestamp.
      const grantState = await communityRewards.getGrant(tokenId)
      expect(grantState.revokedAt).to.bignumber.equal(grantedAt.add(vestingLength.div(new BN(2))))
      const currentTimestamp = await getCurrentTimestamp()
      expect(grantState.revokedAt).to.bignumber.equal(currentTimestamp)

      // Emits event.
      const grantRevokedEvent = getOnlyLog<GrantRevoked>(
        decodeLogs(receipt.receipt.rawLogs, communityRewards, "GrantRevoked")
      )
      expect(grantRevokedEvent.args.tokenId).to.bignumber.equal(tokenId)
      expect(grantRevokedEvent.args.totalUnvested).to.bignumber.equal(expectedTotalUnvested)
    })

    context("paused", async () => {
      it("reverts", async () => {
        const amount = new BN(1e3)
        await mintAndLoadRewards(gfi, communityRewards, owner, amount)
        const tokenId = await grant({
          recipient: anotherUser,
          amount: amount,
          vestingLength: new BN(0),
          cliffLength: new BN(0),
          vestingInterval: new BN(1),
        })
        await communityRewards.pause()
        await expect(communityRewards.revokeGrant(tokenId, {from: owner})).to.be.rejectedWith(/paused/)
      })
    })
  })

  describe("getReward", async () => {
    let amount: BN

    beforeEach(async () => {
      amount = new BN(1e6)
      await mintAndLoadRewards(gfi, communityRewards, owner, amount)
    })
    it("rejects sender who is not owner of the token", async () => {
      const tokenId = await grant({
        recipient: anotherUser,
        amount,
        vestingLength: new BN(1000),
        cliffLength: new BN(0),
        vestingInterval: new BN(1),
      })
      expect(await communityRewards.ownerOf(tokenId)).to.equal(anotherUser)
      await expect(communityRewards.getReward(tokenId, {from: owner})).to.be.rejectedWith(/access denied/)
    })

    it("allows call if claimable amount is 0", async () => {
      const gfiBalanceBefore = await gfi.balanceOf(anotherUser)
      expect(gfiBalanceBefore).to.bignumber.equal(new BN(0))

      const tokenId = await grant({
        recipient: anotherUser,
        amount,
        vestingLength: new BN(1000),
        cliffLength: new BN(500),
        vestingInterval: new BN(1),
      })
      const claimable = await communityRewards.getClaimable(tokenId)
      expect(claimable).to.bignumber.equal(new BN(0))

      const receipt = await communityRewards.getReward(tokenId, {from: anotherUser})

      // Does not increment total claimed.
      const grantState = await communityRewards.getGrant(tokenId)
      expect(grantState.totalClaimed).to.bignumber.equal(new BN(0))

      // Does not transfer GFI.
      const gfiBalanceAfter = await gfi.balanceOf(anotherUser)
      expect(gfiBalanceAfter).to.bignumber.equal(new BN(0))

      // Does not emit event.
      expectEvent.notEmitted(receipt, "RewardPaid")
    })

    it("updates state, transfers rewards, and emits an event, if claimable amount is > 0", async () => {
      const gfiBalanceBefore = await gfi.balanceOf(anotherUser)
      expect(gfiBalanceBefore).to.bignumber.equal(new BN(0))

      const vestingLength = new BN(1000)
      const cliffLength = new BN(500)
      const tokenId = await grant({
        recipient: anotherUser,
        amount,
        vestingLength,
        cliffLength,
        vestingInterval: new BN(1),
      })
      const grantedAt = await getCurrentTimestamp()

      await advanceTime({seconds: cliffLength})
      await ethers.provider.send("evm_mine", [])

      const expectedClaimableAtCliff = amount.mul(cliffLength).div(vestingLength)
      const claimable = await communityRewards.getClaimable(tokenId)
      expect(claimable).to.bignumber.equal(expectedClaimableAtCliff)

      const receipt = await communityRewards.getReward(tokenId, {from: anotherUser})
      const currentTimestamp = await getCurrentTimestamp()
      expect(currentTimestamp).to.bignumber.equal(grantedAt.add(cliffLength).add(new BN(1)))

      const expectedClaimedJustAfterCliff = expectedClaimableAtCliff.add(amount.mul(new BN(1)).div(vestingLength))

      // Increments total claimed.
      const grantState = await communityRewards.getGrant(tokenId)
      expect(grantState.totalGranted).to.bignumber.equal(amount)
      expect(grantState.totalClaimed).to.bignumber.equal(expectedClaimedJustAfterCliff)

      // Transfers GFI.
      const gfiBalanceAfter = await gfi.balanceOf(anotherUser)
      expect(gfiBalanceAfter).to.bignumber.equal(expectedClaimedJustAfterCliff)

      // Emits event.
      const rewardPaidEvent = getOnlyLog<RewardPaid>(
        decodeLogs(receipt.receipt.rawLogs, communityRewards, "RewardPaid")
      )
      expect(rewardPaidEvent.args.user).to.equal(anotherUser)
      expect(rewardPaidEvent.args.tokenId).to.bignumber.equal(tokenId)
      expect(rewardPaidEvent.args.reward).to.bignumber.equal(expectedClaimedJustAfterCliff)

      const expectedClaimableAfterClaimingJustAfterCliff = new BN(0)
      const claimable2 = await communityRewards.getClaimable(tokenId)
      expect(claimable2).to.bignumber.equal(expectedClaimableAfterClaimingJustAfterCliff)
    })

    context("grant with 0 vesting length", async () => {
      it("gets full grant amount", async () => {
        const gfiBalanceBefore = await gfi.balanceOf(anotherUser)
        expect(gfiBalanceBefore).to.bignumber.equal(new BN(0))

        const tokenId = await grant({
          recipient: anotherUser,
          amount,
          vestingLength: new BN(0),
          cliffLength: new BN(0),
          vestingInterval: new BN(1),
        })
        const claimableBefore = await communityRewards.getClaimable(tokenId)
        expect(claimableBefore).to.bignumber.equal(amount)

        await communityRewards.getReward(tokenId, {from: anotherUser})

        const grantState = await communityRewards.getGrant(tokenId)
        expect(grantState.totalClaimed).to.bignumber.equal(amount)

        const gfiBalanceAfter = await gfi.balanceOf(anotherUser)
        expect(gfiBalanceAfter).to.bignumber.equal(amount)

        const claimableAfter = await communityRewards.getClaimable(tokenId)
        expect(claimableAfter).to.bignumber.equal(new BN(0))
      })
    })

    context("grant with > 0 vesting length, 0 cliff", async () => {
      it("gets the vested amount", async () => {
        const gfiBalanceBefore = await gfi.balanceOf(anotherUser)
        expect(gfiBalanceBefore).to.bignumber.equal(new BN(0))

        const vestingLength = new BN(1000)
        const tokenId = await grant({
          recipient: anotherUser,
          amount,
          vestingLength: new BN(1000),
          cliffLength: new BN(0),
          vestingInterval: new BN(1),
        })

        await advanceTime({seconds: vestingLength.div(new BN(2))})

        await communityRewards.getReward(tokenId, {from: anotherUser})

        const expectedClaimed = amount.div(new BN(2))

        const grantState = await communityRewards.getGrant(tokenId)
        expect(grantState.totalClaimed).to.bignumber.equal(expectedClaimed)

        const gfiBalanceAfter = await gfi.balanceOf(anotherUser)
        expect(gfiBalanceAfter).to.bignumber.equal(expectedClaimed)

        const claimableAfter = await communityRewards.getClaimable(tokenId)
        expect(claimableAfter).to.bignumber.equal(new BN(0))
      })
    })

    context("grant with vesting interval of 1", async () => {
      it("gets the vested amount", async () => {})
    })

    context("grant with vesting interval > 1", async () => {
      it("gets full grant amount", async () => {})
    })

    context("grant with vesting interval > 1", async () => {
      it("gets full grant amount", async () => {})
    })

    context("grant with > 0 cliff", async () => {
      it("gets 0 before cliff has elapsed", async () => {})

      it("gets vested amount after cliff has elapsed", async () => {})
    })

    context("revoked grant", async () => {
      it("after revocation, vested amount is still claimable", async () => {})

      it("after revocation, no further amount vests, so no further amount is claimable", async () => {})
    })

    context("paused", async () => {
      it("reverts", async () => {
        const amount = new BN(1e3)
        await mintAndLoadRewards(gfi, communityRewards, owner, amount)
        const tokenId = await grant({
          recipient: anotherUser,
          amount,
          vestingLength: new BN(0),
          cliffLength: new BN(0),
          vestingInterval: new BN(1),
        })
        await communityRewards.pause()
        await expect(communityRewards.getReward(tokenId, {from: anotherUser})).to.be.rejectedWith(/paused/)
      })
    })

    context("reentrancy", async () => {
      it("reverts", async () => {})
    })
  })
})
